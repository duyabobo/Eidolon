import logging
from pathlib import Path

from config import settings

logger = logging.getLogger(__name__)

_GLOBAL_SKILLS_ROOT = Path(settings.sandbox_root) / "global" / "skills"


def _user_skills_root(user_id: str) -> Path:
    return Path(settings.sandbox_root) / "users" / user_id / "skills"


def _skill_file(root: Path, name: str) -> Path:
    return root / name / "SKILL.md"


def read_user_skill_raw(user_id: str, name: str) -> str | None:
    skill_file = _skill_file(_user_skills_root(user_id), name)
    if not skill_file.is_file():
        return None
    return skill_file.read_text(encoding="utf-8")


def read_system_skill_raw(name: str) -> str | None:
    skill_file = _skill_file(_GLOBAL_SKILLS_ROOT, name)
    if not skill_file.is_file():
        return None
    return skill_file.read_text(encoding="utf-8")
