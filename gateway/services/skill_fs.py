import logging
from pathlib import Path

from config import settings

logger = logging.getLogger(__name__)

_GLOBAL_SKILLS_ROOT = Path(settings.sandbox_root) / "global" / "skills"


def _user_skills_root(user_id: str) -> Path:
    return Path(settings.sandbox_root) / "users" / user_id / "skills"


def _build_skill_md(name: str, description: str, content: str) -> str:
    frontmatter = f"---\nname: {name}\ndescription: {description}\n---\n\n"
    return frontmatter + content


def _skill_file(root: Path, name: str) -> Path:
    return root / name / "SKILL.md"


def write_user_skill(user_id: str, name: str, description: str, content: str) -> None:
    root = _user_skills_root(user_id)
    skill_dir = root / name
    skill_dir.mkdir(parents=True, exist_ok=True)
    skill_file = _skill_file(root, name)
    skill_file.write_text(_build_skill_md(name, description, content), encoding="utf-8")
    logger.info("用户 skill 文件已写入 user=%s path=%s", user_id, skill_file)


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


def delete_user_skill_files(user_id: str, name: str) -> bool:
    import shutil

    skill_dir = _user_skills_root(user_id) / name
    if not skill_dir.is_dir():
        return False
    shutil.rmtree(skill_dir)
    logger.info("用户 skill 文件已删除 user=%s path=%s", user_id, skill_dir)
    return True
