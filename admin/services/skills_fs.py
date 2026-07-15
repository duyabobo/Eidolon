"""
Skill 文件系统管理。

存储结构：
  /data/sandboxes/global/skills/{name}/
    SKILL.md      ← pi 直接读取（frontmatter + 正文）

全局 skill（admin 管理的公共 skill）放在 global/skills/。
用户 skill 放在 users/{user_id}/skills/，仅通过 skill-creator 对话创建。

SKILL.md 格式（Agent Skills 标准）：
  ---
  name: python-expert
  description: 当用户需要写 Python 代码时使用
  ---
  skill 正文指令...
"""
import logging
import os
from pathlib import Path

from config import settings

logger = logging.getLogger(__name__)

_GLOBAL_SKILLS_ROOT = Path(settings.sandbox_root) / "global" / "skills"


def _user_skills_root(user_id: str) -> Path:
    return Path(settings.sandbox_root) / "users" / user_id / "skills"


def _skill_dir(name: str) -> Path:
    return _GLOBAL_SKILLS_ROOT / name


def _skill_file(name: str) -> Path:
    return _skill_dir(name) / "SKILL.md"


def _build_skill_md(
    name: str,
    description: str,
    content: str,
    mcp_servers: list[str] | None = None,
    mcp_tools: list[str] | None = None,
) -> str:
    """
    按 Agent Skills 标准拼装 SKILL.md 内容。

    mcp_servers 仅写入 frontmatter 供人类查看溯源（这个 skill 的工具来自哪些 Server）；
    mcp_tools 才是运行时白名单（精确到工具名），实际生效的是 MongoDB SkillMeta.mcp_tools，
    frontmatter 里的 mcp_tools 只是让 SKILL.md 文件本身自描述、便于版本管理时查看。
    """
    lines = ["---", f"name: {name}", f"description: {description}"]
    servers = [item.strip() for item in (mcp_servers or []) if item.strip()]
    if servers:
        lines.append("mcp_servers:")
        lines.extend(f"  - {item}" for item in servers)
    tools = [item.strip() for item in (mcp_tools or []) if item.strip()]
    if tools:
        lines.append("mcp_tools:")
        lines.extend(f"  - {item}" for item in tools)
    lines.extend(["---", ""])
    return "\n".join(lines) + content


def write_skill(
    name: str,
    description: str,
    content: str,
    references: dict[str, str] | None = None,
    mcp_servers: list[str] | None = None,
    mcp_tools: list[str] | None = None,
) -> None:
    """将系统 skill 写入 global/skills/{name}/SKILL.md"""
    _write_skill_files(_skill_dir(name), name, description, content, references, mcp_servers, mcp_tools)


def write_user_skill(
    user_id: str,
    name: str,
    description: str,
    content: str,
    references: dict[str, str] | None = None,
    mcp_servers: list[str] | None = None,
    mcp_tools: list[str] | None = None,
) -> None:
    """将用户 skill 写入 users/{user_id}/skills/{name}/SKILL.md"""
    _write_skill_files(
        _user_skills_root(user_id) / name, name, description, content, references, mcp_servers, mcp_tools,
    )


def _write_skill_files(
    skill_dir: Path,
    name: str,
    description: str,
    content: str,
    references: dict[str, str] | None,
    mcp_servers: list[str] | None = None,
    mcp_tools: list[str] | None = None,
) -> None:
    skill_dir.mkdir(parents=True, exist_ok=True)
    skill_file = skill_dir / "SKILL.md"
    skill_file.write_text(_build_skill_md(name, description, content, mcp_servers, mcp_tools), encoding="utf-8")
    logger.info("skill 文件已写入: %s", skill_file)

    if not references:
        return
    ref_dir = skill_dir / "references"
    ref_dir.mkdir(parents=True, exist_ok=True)
    for filename, ref_content in references.items():
        safe_name = Path(filename).name
        if not safe_name:
            continue
        ref_file = ref_dir / safe_name
        ref_file.write_text(ref_content, encoding="utf-8")
        logger.info("skill 引用文档已写入: %s", ref_file)


def read_skill_content(name: str) -> str | None:
    """读取 global skill 的 SKILL.md 原始内容（含 frontmatter）"""
    skill_file = _skill_file(name)
    if not skill_file.exists():
        return None
    return skill_file.read_text(encoding="utf-8")


def delete_skill_files(name: str) -> bool:
    """删除 global skill 文件目录"""
    import shutil
    skill_dir = _skill_dir(name)
    if not skill_dir.exists():
        return False
    shutil.rmtree(skill_dir)
    logger.info("skill 文件目录已删除: %s", skill_dir)
    return True


def delete_user_skill_files(user_id: str, name: str) -> bool:
    """删除用户 skill 文件目录"""
    import shutil
    skill_dir = _user_skills_root(user_id) / name
    if not skill_dir.exists():
        return False
    shutil.rmtree(skill_dir)
    logger.info("用户 skill 文件目录已删除: user=%s skill=%s", user_id, name)
    return True


def get_global_skills_root() -> str:
    """返回全局 skill 根目录绝对路径（供 pi-runtime 使用）"""
    _GLOBAL_SKILLS_ROOT.mkdir(parents=True, exist_ok=True)
    return str(_GLOBAL_SKILLS_ROOT)
