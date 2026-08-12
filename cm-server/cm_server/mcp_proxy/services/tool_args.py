import logging
from typing import Any

from pi_shared.knowledge_constants import KNOWLEDGE_SCENE_TYPE

logger = logging.getLogger(__name__)

_WIKI_SCENE_TYPE_TOOLS = frozenset({"wiki_get_or_create_knowledge_key"})
_WIKI_SIMPLE_PROCESS_TOOL = "wiki_simple_process"
_AGENT_HEADERS_KEY = "headers"


def normalize_tool_arguments(
    tool_name: str,
    args: dict[str, Any],
    trusted_user_id: str | None = None,
) -> dict[str, Any]:
    """修正 MCP 工具参数，避免 Agent 传入导致长阻塞或非法租户参数。"""
    normalized = dict(args)

    if tool_name == _WIKI_SIMPLE_PROCESS_TOOL:
        previous = normalized.get("wait_for_completion")
        if previous is not False:
            logger.info(
                "wiki 工具 wait_for_completion 已修正 tool=%s from=%s to=%s",
                tool_name,
                previous,
                False,
            )
            normalized["wait_for_completion"] = False

    if tool_name in _WIKI_SCENE_TYPE_TOOLS:
        previous = normalized.get("scene_type")
        if previous != KNOWLEDGE_SCENE_TYPE:
            logger.info(
                "wiki 工具 scene_type 已修正 tool=%s from=%s to=%s",
                tool_name,
                previous,
                KNOWLEDGE_SCENE_TYPE,
            )
        normalized["scene_type"] = KNOWLEDGE_SCENE_TYPE

    _override_forged_user_in_headers(tool_name, normalized, trusted_user_id)
    return normalized


def _override_forged_user_in_headers(
    tool_name: str,
    args: dict[str, Any],
    trusted_user_id: str | None,
) -> None:
    """Agent 若在 arguments.headers 里带了 x-user-id，强制改为入站可信身份。"""
    if not trusted_user_id:
        return
    raw_headers = args.get(_AGENT_HEADERS_KEY)
    if not isinstance(raw_headers, dict):
        return

    headers = dict(raw_headers)
    forged = None
    for key in list(headers):
        if str(key).lower() == "x-user-id":
            forged = headers.pop(key)
    headers["x-user-id"] = trusted_user_id
    if forged is not None and str(forged) != trusted_user_id:
        logger.info(
            "工具参数 headers.x-user-id 已覆盖 tool=%s from=%s to=%s",
            tool_name,
            forged,
            trusted_user_id,
        )
    args[_AGENT_HEADERS_KEY] = headers
