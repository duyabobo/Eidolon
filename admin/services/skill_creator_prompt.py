import logging
from functools import lru_cache
from pathlib import Path

logger = logging.getLogger(__name__)

_SKILL_CREATOR_ROOT = Path(__file__).resolve().parent.parent / "skill_creator"


@lru_cache(maxsize=1)
def load_system_prompt() -> str:
    platform_path = _SKILL_CREATOR_ROOT / "PLATFORM.md"
    skill_path = _SKILL_CREATOR_ROOT / "SKILL.md"
    schemas_path = _SKILL_CREATOR_ROOT / "references" / "schemas.md"

    parts: list[str] = []
    if platform_path.exists():
        parts.append(platform_path.read_text(encoding="utf-8"))
    if skill_path.exists():
        parts.append("# Skill Creator 参考文档\n\n" + skill_path.read_text(encoding="utf-8"))
    if schemas_path.exists():
        parts.append("# 输出 Schema 参考\n\n" + schemas_path.read_text(encoding="utf-8"))

    prompt = "\n\n---\n\n".join(parts)
    logger.info("skill-creator system prompt 已加载，长度=%d", len(prompt))
    return prompt
