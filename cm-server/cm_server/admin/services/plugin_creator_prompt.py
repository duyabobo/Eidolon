import logging
from functools import lru_cache
from pathlib import Path

logger = logging.getLogger(__name__)

_ROOT = Path(__file__).resolve().parent.parent / "plugin_creator"


@lru_cache(maxsize=1)
def load_plugin_system_prompt() -> str:
    path = _ROOT / "PLATFORM.md"
    prompt = path.read_text(encoding="utf-8") if path.exists() else "你是本机插件创建助手。"
    logger.info("plugin-creator system prompt 已加载，长度=%d", len(prompt))
    return prompt
