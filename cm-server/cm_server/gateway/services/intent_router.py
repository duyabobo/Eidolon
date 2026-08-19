"""进 Agent Loop 前的意图分流：看最近几轮、消歧、再点名本轮工具。"""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass

import httpx

from cm_server.gateway.services.intent_history import extract_recent_turns, format_recent_turns
from cm_server.gateway.services.intent_rules import match_direct_rule
from cm_server.gateway.services.skill_meta_store import list_skills_for_user

logger = logging.getLogger(__name__)

INTENT_DIRECT = "direct"
INTENT_KNOWLEDGE = "knowledge"
INTENT_TOOLS = "tools"
INTENT_WORKSPACE = "workspace"
INTENT_SKILL = "skill"
INTENTS = frozenset({
    INTENT_DIRECT, INTENT_KNOWLEDGE, INTENT_TOOLS, INTENT_WORKSPACE, INTENT_SKILL,
})

MCP_MODE_ALL = "all"
MCP_MODE_NONE = "none"
MCP_MODE_ALLOW = "allow"

BUILTIN_ALL = ("read", "write", "edit", "find", "grep", "ls", "bash")
RAG_BUILTINS = ("grep", "read")
WIKI_REL_DIR = "wiki"

_CLASSIFY_TIMEOUT_S = 12.0
_SHORT_FALLBACK_CHARS = 24
_CATALOG_LIMIT = 40
_DESC_CHARS = 72

_JSON_FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```$", re.IGNORECASE)


@dataclass(frozen=True)
class IntentPolicy:
    intent: str
    reason: str
    allow_builtin: tuple[str, ...]
    mcp_mode: str
    allow_mcp: tuple[str, ...]
    resolved_query: str = ""
    need_rag: bool = False

    def to_payload(self) -> dict:
        return {
            "intent": self.intent,
            "reason": self.reason,
            "allow_builtin": list(self.allow_builtin),
            "mcp_mode": self.mcp_mode,
            "allow_mcp": list(self.allow_mcp),
            "need_rag": self.need_rag,
        }


def apply_route_prefix(text: str, policy: IntentPolicy) -> str:
    query = (policy.resolved_query or text).strip() or text
    lines = [f"【本轮路由：{policy.intent}】{policy.reason}"]
    if policy.resolved_query and policy.resolved_query.strip() != (text or "").strip():
        lines.append(f"消歧后的问题：{policy.resolved_query.strip()}")
    if policy.need_rag:
        lines.append(
            f"需要查阅本地知识：用 grep/read 检索目录 {WIKI_REL_DIR}/，不要 bash 扫全盘。"
        )
    if policy.allow_mcp:
        lines.append("本轮可用 MCP：" + "、".join(policy.allow_mcp))
    elif policy.mcp_mode == MCP_MODE_ALL:
        lines.append("本轮可使用已加载的 MCP 工具。")
    elif policy.mcp_mode == MCP_MODE_NONE:
        lines.append("本轮不要调用 MCP。")
    if policy.intent == INTENT_DIRECT:
        lines.append("本轮只做简单问答：不要调用任何工具，直接用文字回答。")
    elif policy.allow_builtin:
        lines.append("本轮可用内置工具：" + "、".join(policy.allow_builtin))
    else:
        lines.append("本轮禁止 read/write/edit/bash/grep 等内置工具，直接用文字回答。")
    lines.append("")
    lines.append(query)
    return "\n".join(lines)


def _parse_router_json(raw: str) -> dict:
    cleaned = _JSON_FENCE_RE.sub("", (raw or "").strip())
    data = json.loads(cleaned)
    if not isinstance(data, dict):
        raise RuntimeError("意图结果不是对象")
    return data


async def _list_mcp_catalog(user_id: str) -> list[tuple[str, str]]:
    from cm_server.mcp_proxy.services.manager import manager

    view = await manager.get_tools(user_id)
    catalog: list[tuple[str, str]] = []
    for item in view.list_tools():
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        desc = str(item.get("description") or "").replace("\n", " ").strip()
        catalog.append((name, desc[:_DESC_CHARS]))
        if len(catalog) >= _CATALOG_LIMIT:
            break
    logger.info("意图 MCP 目录 user=%s count=%s", user_id, len(catalog))
    return catalog


async def _resolve_intent_client() -> tuple[str, str, str, float, str]:
    """返回 (base_url, api_key, model, timeout, source)。意图识别走当前聊天大模型。"""
    from cm_server.llm_proxy.services.llm_profile_store import get_active_llm_profile

    active = await get_active_llm_profile()
    if active is None:
        raise RuntimeError("请先在配置页添加并激活聊天大模型")
    timeout = min(float(active.timeout or _CLASSIFY_TIMEOUT_S), _CLASSIFY_TIMEOUT_S)
    return active.base_url.rstrip("/"), active.api_key, active.model, timeout, "chat"


async def _chat_router(system: str, user: str) -> tuple[str, str]:
    base_url, api_key, model, timeout, source = await _resolve_intent_client()
    url = f"{base_url}/chat/completions"
    headers = {"Authorization": f"Bearer {api_key or 'EMPTY'}"}
    payload = {
        "model": model,
        "temperature": 0,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    }
    async with httpx.AsyncClient(timeout=timeout, trust_env=False) as client:
        resp = await client.post(url, json=payload, headers=headers)
        resp.raise_for_status()
        data = resp.json()
    content = (
        ((data.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
    )
    logger.info("意图模型 source=%s model=%s chars=%s", source, model, len(content))
    return content, source


def _pick_mcp(selected: object, catalog_names: set[str]) -> tuple[str, ...]:
    if not isinstance(selected, list):
        return ()
    return tuple(
        dict.fromkeys(
            name.strip()
            for name in selected
            if isinstance(name, str) and name.strip() in catalog_names
        )
    )


def _pick_builtins(selected: object, *, need_rag: bool) -> tuple[str, ...]:
    allowed = set(BUILTIN_ALL)
    names: list[str] = []
    if isinstance(selected, list):
        names.extend(
            name.strip()
            for name in selected
            if isinstance(name, str) and name.strip() in allowed
        )
    if need_rag:
        names.extend(RAG_BUILTINS)
    return tuple(dict.fromkeys(names))


async def _classify(
    text: str,
    *,
    user_id: str,
    skill_ids: list[str],
    history: list[tuple[str, str]],
) -> dict:
    catalog = await _list_mcp_catalog(user_id)
    catalog_names = {name for name, _desc in catalog}
    catalog_lines = (
        "\n".join(f"- {name}: {desc}" for name, desc in catalog)
        or "- （已配置，名单暂未载入；需要外部检索时 intent=tools，mcp_tools 留空）"
    )
    skills = await list_skills_for_user(user_id)
    skill_lines = "\n".join(
        f"- {item.name}: {(item.description or '')[:80]}"
        for item in skills[:30]
    ) or "- （无）"
    system = (
        "你是对话路由器。先根据最近几轮把当前问题写完整：展开代词（它/这个/刚才/同上），"
        "消除歧义，不要改用户原意。再判断本轮要不要工具。"
        "只输出 JSON："
        '{"resolved_query":"...","intent":"direct|knowledge|tools|workspace|skill",'
        '"reason":"短原因","mcp_tools":["工具名"],'
        '"builtins":["read|write|edit|bash|find|grep|ls"],"need_rag":false}。'
        "direct=闲聊/通识，mcp_tools 与 builtins 都为空，need_rag=false；"
        "knowledge=查用户已有资料，need_rag=true，builtins 通常只要 grep/read；"
        "tools=外部 MCP；workspace=改本地文件或跑命令；"
        "skill=走已选/匹配的经验。"
        "mcp_tools 只能从目录里选，宁缺毋滥。不要为了闲聊选工具。"
    )
    user = (
        f"最近几轮：\n{format_recent_turns(history)}\n\n"
        f"当前用户说：{text[:800]}\n"
        f"用户已选经验：{'、'.join(skill_ids) if skill_ids else '无'}\n"
        f"可选经验：\n{skill_lines}\n"
        f"可选 MCP：\n{catalog_lines}\n"
        f"内置工具只能是：{', '.join(BUILTIN_ALL)}\n"
        f"need_rag=true 表示到 {WIKI_REL_DIR}/ 目录 grep/read wiki 文件。"
    )
    raw, source = await _chat_router(system, user)
    data = _parse_router_json(raw)
    intent = str(data.get("intent") or "").strip()
    if intent not in INTENTS:
        raise RuntimeError(f"未知 intent: {intent}")
    need_rag = bool(data.get("need_rag"))
    if intent == INTENT_KNOWLEDGE:
        need_rag = True
    if intent == INTENT_DIRECT:
        need_rag = False
    resolved = str(data.get("resolved_query") or text).strip() or text
    mcp_tools = _pick_mcp(data.get("mcp_tools"), catalog_names)
    builtins = _pick_builtins(data.get("builtins"), need_rag=need_rag)
    if intent == INTENT_DIRECT:
        mcp_tools = ()
        builtins = ()
    logger.info(
        "意图已判定 source=%s intent=%s rag=%s mcp=%s builtin=%s resolved=%s",
        source,
        intent,
        need_rag,
        ",".join(mcp_tools) or "-",
        ",".join(builtins) or "-",
        resolved[:80],
    )
    return {
        "intent": intent,
        "reason": str(data.get("reason") or source).strip() or source,
        "resolved_query": resolved,
        "need_rag": need_rag,
        "mcp_tools": mcp_tools,
        "builtins": builtins,
    }


def _mcp_mode_for(intent: str, mcp_tools: tuple[str, ...]) -> str:
    if intent == INTENT_DIRECT:
        return MCP_MODE_NONE
    if mcp_tools:
        return MCP_MODE_ALLOW
    # 目录空或点名被滤掉时，不能把「要用工具」收成 0 个 MCP
    if intent in {INTENT_TOOLS, INTENT_SKILL}:
        return MCP_MODE_ALL
    return MCP_MODE_NONE


def _policy_from_decision(decision: dict) -> IntentPolicy:
    intent = str(decision["intent"])
    mcp_tools: tuple[str, ...] = tuple(decision["mcp_tools"])
    if intent == INTENT_DIRECT:
        mcp_tools = ()
    return IntentPolicy(
        intent=intent,
        reason=str(decision["reason"]),
        allow_builtin=tuple(decision["builtins"]),
        mcp_mode=_mcp_mode_for(intent, mcp_tools),
        allow_mcp=mcp_tools,
        resolved_query=str(decision["resolved_query"]),
        need_rag=bool(decision["need_rag"]),
    )


async def route_intent(
    text: str,
    *,
    user_id: str,
    skill_ids: list[str] | None,
    recent_events: list[dict] | None = None,
) -> IntentPolicy:
    ids = [item for item in (skill_ids or []) if item.strip()]
    history = extract_recent_turns(recent_events)
    rule_reason = match_direct_rule(text)
    if rule_reason:
        logger.info("意图规则命中 reason=%s text=%s", rule_reason, (text or "")[:80])
        return IntentPolicy(
            INTENT_DIRECT, rule_reason, (), MCP_MODE_NONE, (),
            resolved_query=(text or "").strip(),
            need_rag=False,
        )

    try:
        decision = await _classify(text, user_id=user_id, skill_ids=ids, history=history)
        policy = _policy_from_decision(decision)
    except (httpx.HTTPError, json.JSONDecodeError, RuntimeError) as exc:
        short = len((text or "").strip()) < _SHORT_FALLBACK_CHARS
        intent = INTENT_DIRECT if short else INTENT_WORKSPACE
        builtins = () if short else BUILTIN_ALL
        logger.warning("意图识别回退 intent=%s error=%s", intent, exc)
        policy = IntentPolicy(
            intent,
            f"识别失败回退:{exc}",
            builtins,
            MCP_MODE_NONE,
            (),
            resolved_query=(text or "").strip(),
            need_rag=False,
        )

    logger.info(
        "意图已分流 intent=%s rag=%s builtin=%s mcp_mode=%s mcp=%s",
        policy.intent,
        policy.need_rag,
        ",".join(policy.allow_builtin) or "-",
        policy.mcp_mode,
        ",".join(policy.allow_mcp) or "-",
    )
    return policy
