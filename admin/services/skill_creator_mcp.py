import logging
import re
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode

import httpx

from config import settings
from models.skill_creator import SkillDraft
from pi_shared import merge_trace_headers
from services import mongo_client

logger = logging.getLogger(__name__)

_REQUEST_TIMEOUT_SECONDS = 60.0
_MCP_REFERENCE_SECTION = "## MCP 工具参考"


@dataclass
class McpServerToolsInfo:
    name: str
    scope: str
    url: str
    enabled: bool
    available: bool
    tools: list[str]
    error: str = ""


async def list_configured_mcp_names(user_id: str | None) -> list[str]:
    db = mongo_client.get_db()
    names: set[str] = set()

    system_filter = {"$or": [{"user_id": None}, {"user_id": {"$exists": False}}]}
    async for raw in db.mcp_servers.find(system_filter):
        if raw.get("name"):
            names.add(str(raw["name"]))

    if user_id and user_id.strip():
        async for raw in db.mcp_servers.find({"user_id": user_id.strip()}):
            if raw.get("name"):
                names.add(str(raw["name"]))

    return sorted(names)


def _extract_explicit_mcp_servers(text: str) -> list[str]:
    patterns = [
        r"mcp[_\s-]?servers?\s*[:：]\s*\[([^\]]+)\]",
        r"mcp[_\s-]?servers?\s*[:：]\s*([^\n,，;；]+)",
        r"```json\s*\n[^`]*\"mcp_servers\"\s*:\s*\[(.*?)\]",
    ]
    found: list[str] = []
    for pattern in patterns:
        for match in re.finditer(pattern, text, re.IGNORECASE | re.DOTALL):
            chunk = match.group(1)
            for token in re.split(r"[,，\n]", chunk):
                cleaned = token.strip().strip('"\'` ')
                if cleaned:
                    found.append(cleaned)
    return found


def resolve_mcp_server_names(
    user_message: str,
    draft: SkillDraft | None,
    history_text: str,
    configured_names: list[str],
) -> list[str]:
    if not configured_names:
        return []

    resolved: set[str] = set()
    if draft and draft.mcp_servers:
        configured_lower = {name.lower(): name for name in configured_names}
        for token in draft.mcp_servers:
            key = token.strip().lower()
            if key in configured_lower:
                resolved.add(configured_lower[key])

    combined = "\n".join(part for part in [history_text, user_message] if part)
    for explicit in _extract_explicit_mcp_servers(combined):
        configured_lower = {name.lower(): name for name in configured_names}
        key = explicit.lower()
        if key in configured_lower:
            resolved.add(configured_lower[key])

    lower_combined = combined.lower()
    for name in configured_names:
        if name.lower() in lower_combined:
            resolved.add(name)

    return sorted(resolved)


def _parse_servers_payload(payload: dict[str, Any], requested_names: list[str]) -> list[McpServerToolsInfo]:
    servers = payload.get("servers") if isinstance(payload, dict) else []
    by_name = {str(item.get("name")): item for item in servers if item.get("name")}

    results: list[McpServerToolsInfo] = []
    for name in requested_names:
        raw = by_name.get(name)
        if not raw:
            results.append(McpServerToolsInfo(
                name=name,
                scope="unknown",
                url="",
                enabled=True,
                available=False,
                tools=[],
                error="MCP Server 未找到",
            ))
            continue
        results.append(McpServerToolsInfo(
            name=str(raw.get("name") or name),
            scope=str(raw.get("scope") or "unknown"),
            url=str(raw.get("url") or ""),
            enabled=bool(raw.get("enabled", True)),
            available=bool(raw.get("available")),
            tools=[str(tool) for tool in (raw.get("tools") or [])],
            error=str(raw.get("error") or ""),
        ))
    return results


async def fetch_mcp_tools(user_id: str | None, server_names: list[str]) -> list[McpServerToolsInfo]:
    if not server_names:
        return []

    headers = merge_trace_headers()
    if user_id and user_id.strip():
        headers["X-User-Id"] = user_id.strip()

    base = settings.mcp_proxy_base_url.rstrip("/")
    query = urlencode({"include_disabled": "true", "names": ",".join(server_names)})
    url = f"{base}/servers/status?{query}"

    async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT_SECONDS) as client:
        try:
            resp = await client.get(url, headers=headers)
            resp.raise_for_status()
            payload = resp.json()
        except Exception as exc:
            logger.warning("批量拉取 MCP tools 失败 servers=%s err=%s", server_names, exc)
            return [
                McpServerToolsInfo(
                    name=name,
                    scope="unknown",
                    url="",
                    enabled=True,
                    available=False,
                    tools=[],
                    error=str(exc),
                )
                for name in server_names
            ]

    results = _parse_servers_payload(payload, server_names)
    logger.info(
        "skill-creator MCP tools 已拉取 user=%s servers=%s",
        user_id or "-",
        [item.name for item in results],
    )
    return results


def build_mcp_prompt_context(infos: list[McpServerToolsInfo]) -> str:
    if not infos:
        return ""

    lines = [
        "\n\n---\n\n## 平台注入：MCP Server 工具清单（经 mcp-proxy 按 Server 名实时拉取）\n",
        "用户已提到 MCP Server；下列 tool list 来自 **mcp-proxy 服务接口**（按业务 Server 名过滤）。\n",
        "你必须先基于本清单编写 Skill，再描述调用方式；禁止跳过 tool list 臆造工具名。\n",
        "Skill `content` 须写明运行时标准顺序：",
        "① 只连 `mcp-proxy` → ② `mcp({ server: \"mcp-proxy\" })` 拉 tool list → ",
        "③ 结合 Skill 描述与 tool list 再发起工具调用。\n",
        "业务 Server 名只写入 `mcp_servers` 供平台过滤，",
        "**禁止**让 Agent 对业务名执行 `mcp({ server: \"业务名\" })`。\n",
        "**不要**在 references 中写死 tool 列表（运行时再经 mcp-proxy 拉取）。\n",
    ]
    for info in infos:
        lines.append(f"\n### MCP Server `{info.name}` ({info.scope})\n")
        if not info.enabled:
            lines.append("- 状态：已禁用，暂不可用\n")
            continue
        if not info.available:
            lines.append(f"- 状态：不可用\n- 错误：{info.error or '连接失败'}\n")
            continue
        lines.append(f"- 状态：可用 · {len(info.tools)} 个工具\n")
        if info.tools:
            lines.append("- 工具列表：\n")
            for tool in info.tools:
                lines.append(f"  - `{tool}`\n")
        else:
            lines.append("- 工具列表：（空）\n")

    lines.append(
        "\n在输出 `skill-draft` 时，请设置 `mcp_servers` 为上述 Server 名称数组，"
        "并在 `content` 中包含完整的 MCP / mcp-proxy 使用说明（无需 references/mcp-tools.md）。\n"
    )
    return "".join(lines)


def enrich_draft_with_mcp_reference(draft: SkillDraft, infos: list[McpServerToolsInfo]) -> SkillDraft:
    if not infos:
        return draft

    content = draft.content.strip()
    server_names = [info.name for info in infos]

    if _MCP_REFERENCE_SECTION not in content:
        summary_lines = [
            _MCP_REFERENCE_SECTION,
            "",
            "标准顺序：先经 **mcp-proxy** 拉 tool list（`mcp({ server: \"mcp-proxy\" })`），",
            "再结合本 Skill 描述与 tool list 完成调用；禁止对业务 Server 名做 connect 探测。",
            "业务名仅写入 `mcp_servers` 供平台白名单过滤。",
            "",
        ]
        for info in infos:
            if info.available and info.tools:
                summary_lines.append(
                    f"- 业务能力 **{info.name}**（{info.scope}）：约 {len(info.tools)} 个工具，"
                    "经 mcp-proxy 聚合暴露（勿把该名称当作 Agent 侧 server 去 connect）"
                )
            elif not info.enabled:
                summary_lines.append(f"- **{info.name}**：已禁用")
            else:
                summary_lines.append(f"- **{info.name}**：不可用（{info.error or '连接失败'}）")
        summary_lines.append("")
        content = content + "\n\n" + "\n".join(summary_lines)

    return draft.model_copy(update={
        "content": content.strip(),
        "mcp_servers": server_names,
        "mcp_tools_reference": "",
    })


async def prepare_mcp_context_for_message(
    user_id: str | None,
    user_message: str,
    draft: SkillDraft | None,
    history_text: str,
) -> tuple[str, list[McpServerToolsInfo]]:
    configured = await list_configured_mcp_names(user_id)
    server_names = resolve_mcp_server_names(user_message, draft, history_text, configured)
    if not server_names:
        return "", []

    infos = await fetch_mcp_tools(user_id, server_names)
    return build_mcp_prompt_context(infos), infos
