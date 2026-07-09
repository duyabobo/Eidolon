import logging
from typing import Any

from pi_shared.knowledge_constants import KNOWLEDGE_SCENE_TYPE

logger = logging.getLogger(__name__)

_WIKI_SCENE_TYPE_TOOLS = frozenset({"wiki_get_or_create_knowledge_key"})


def normalize_tool_arguments(tool_name: str, args: dict[str, Any]) -> dict[str, Any]:
    """修正 MCP 工具参数，避免 Agent 传入非法 scene_type。"""
    if tool_name not in _WIKI_SCENE_TYPE_TOOLS:
        return args

    normalized = dict(args)
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
