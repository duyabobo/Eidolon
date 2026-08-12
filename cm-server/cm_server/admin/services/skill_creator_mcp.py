import logging
import re
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode

import httpx

from cm_server.admin.config import settings
from cm_server.admin.models.skill_creator import SkillDraft
from pi_shared import merge_trace_headers
from cm_server.admin.services.db import get_db

logger = logging.getLogger(__name__)

_REQUEST_TIMEOUT_SECONDS = 60.0
# 旧版 PLATFORM / enrich 曾要求写入的冗余段：运行时已按 mcp_tools 注入工具，正文不必再写。
_MCP_BOILERPLATE_SECTION = re.compile(
    r"(?:\n*## MCP 工具(?:使用|参考)\s*\n.*?)(?=\n## |\Z)",
    re.DOTALL,
)


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
    db = get_db()
    names: set[str] = set()

    system_rows = await db.fetch_all("SELECT name FROM mcp_servers WHERE user_id IS NULL")
    names.update(str(row["name"]) for row in system_rows if row.get("name"))

    uid = (user_id or "").strip()
    if uid:
        user_rows = await db.fetch_all("SELECT name FROM mcp_servers WHERE user_id = ?", (uid,))
        names.update(str(row["name"]) for row in user_rows if row.get("name"))

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
    history_text: str,
    configured_names: list[str],
) -> list[str]:
    """从对话文本里识别用户提到的已配置 MCP Server 名（创作阶段用，定位去哪拉 tool list）。

    只用于拉取 tool list，不写入最终 Skill——Skill 只记录 mcp_tools（具体工具名）。
    历史消息里出现过的 Server 名天然保留在 history_text 里，无需额外从草稿里记忆。
    """
    if not configured_names:
        return []

    resolved: set[str] = set()
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
        "白名单是**工具粒度**，不是 Server 粒度：从下面清单里挑出这个 Skill 实际会用到的具体工具名"
        "（不需要每个都用，只挑相关的），写入 `mcp_tools`。运行时 pi 只能看到 `mcp_tools` 里列出的工具，"
        "看不到 Server 名，也看不到未列出的工具。Skill 不记录、也不需要记录工具来自哪个 Server。\n",
        "Skill `content` 只描述**工具名**和调用顺序/参数/降级策略，**不要出现业务 Server 名**"
        "（如下面清单标题里的名字）——运行时 Agent 根本看不到 Server 名，写了也没用，还会误导它去猜"
        "`mcp({ server: \"业务名\" })`（一定会失败）。\n",
        "**不要**在 references 中写死 tool 列表（运行时再经 mcp-proxy 拉取，也不需要 Agent 自己拉）。\n",
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
        "\n在输出 `skill-draft` 时，请设置 `mcp_tools` 为你从上面清单里挑出的具体工具名数组"
        "（这才是运行时真正生效的白名单）；不要输出 `mcp_servers` 或任何业务 Server 名。"
        "`content` 只写业务步骤（何时用哪个工具名、关键参数、降级），"
        "**禁止**再写「MCP 工具使用 / MCP 工具参考」、"
        "禁止写 mcp-proxy 探测/`mcp({ server: ... })`/拉 tool list 等平台机制说明——"
        "运行时工具已按 `mcp_tools` 自动注入。\n"
    )
    return "".join(lines)


def strip_redundant_mcp_sections(content: str) -> str:
    """去掉正文中的「MCP 工具使用/参考」boilerplate（白名单已由平台注入）。"""
    cleaned = _MCP_BOILERPLATE_SECTION.sub("", content or "")
    return cleaned.strip()


def enrich_draft_with_mcp_reference(draft: SkillDraft, infos: list[McpServerToolsInfo]) -> SkillDraft:
    """根据拉取到的 Server 工具，补齐 mcp_tools 元数据；不改业务流程正文，不记录 Server 名。"""
    content = strip_redundant_mcp_sections(draft.content)
    if not infos:
        if content == draft.content.strip():
            return draft
        return draft.model_copy(update={"content": content, "mcp_tools_reference": ""})

    available_tools = sorted({tool for info in infos if info.available for tool in info.tools})

    # 模型已经按新规则在 draft.mcp_tools 里挑了具体工具就尊重它的选择；
    # 没挑（例如模型忘记按规则输出）时兜底成这些 Server 当前的全部工具，
    # 避免出现「提到了某个 Server 但白名单一个工具都没有」的空白态。
    mcp_tools = list(draft.mcp_tools) if draft.mcp_tools else available_tools

    return draft.model_copy(update={
        "content": content,
        "mcp_tools": mcp_tools,
        "mcp_tools_reference": "",
    })


async def prepare_mcp_context_for_message(
    user_id: str | None,
    user_message: str,
    history_text: str,
) -> tuple[str, list[McpServerToolsInfo]]:
    configured = await list_configured_mcp_names(user_id)
    server_names = resolve_mcp_server_names(user_message, history_text, configured)
    if not server_names:
        return "", []

    infos = await fetch_mcp_tools(user_id, server_names)
    return build_mcp_prompt_context(infos), infos
