import logging
from typing import Any

from pi_shared.knowledge_constants import KNOWLEDGE_SCENE_TYPE

logger = logging.getLogger(__name__)

_WIKI_SCENE_TYPE_TOOLS = frozenset({"wiki_get_or_create_knowledge_key"})
_WIKI_SIMPLE_PROCESS_TOOL = "wiki_simple_process"


def normalize_tool_arguments(tool_name: str, args: dict[str, Any]) -> dict[str, Any]:
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
        return normalized

    if tool_name not in _WIKI_SCENE_TYPE_TOOLS:
        return args

    previous = normalized.get("scene_type")
    if previous != KNOWLEDGE_SCENE_TYPE:
        logger.info(
            "wiki 工具 scene_type 已修正 tool=%s from=%s to=%s",
            tool_name,
            previous,
            KNOWLEDGE_SCENE_TYPE,
        )
    normalized["scene_type"] = KNOWLEDGE_SCENE_TYPE
    return normalized
