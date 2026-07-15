"""
Skill 文件系统管理。

存储结构：
  /data/sandboxes/global/skills/{name}/
    SKILL.md      ← pi 直接读取（frontmatter + 正文）
    uploads/      ← skill-creator 会话上传附件

全局 skill（admin 管理的公共 skill）放在 global/skills/。
用户 skill 放在 users/{user_id}/skills/，仅通过 skill-creator 对话创建。

尚无 skill 名时，暂存到 skills/_creator/{session_id}/uploads/。

SKILL.md 格式（Agent Skills 标准）：
  ---
  name: python-expert
  description: 当用户需要写 Python 代码时使用
  ---
  skill 正文指令...
"""
import logging
import re
from pathlib import Path

from config import settings
from constants.workspace import MAX_UPLOAD_BYTES

logger = logging.getLogger(__name__)

_GLOBAL_SKILLS_ROOT = Path(settings.sandbox_root) / "global" / "skills"
_UNSAFE_NAME_RE = re.compile(r'[/\\\0:*?"<>|]')
_CREATOR_STAGING_DIR = "_creator"
_UPLOADS_SUBDIR = "uploads"


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
    mcp_tools: list[str] | None = None,
) -> str:
    """
    按 Agent Skills 标准拼装 SKILL.md 内容。

    只写 mcp_tools（精确到工具名的运行时白名单，实际生效的是 MongoDB SkillMeta.mcp_tools，
    frontmatter 里的 mcp_tools 只是让 SKILL.md 文件本身自描述、便于版本管理时查看）。
    不写业务 Server 名：pi 运行时看不到 Server 名，记了没用，Skill 只需描述用到的工具。
    """
    lines = ["---", f"name: {name}", f"description: {description}"]
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
    mcp_tools: list[str] | None = None,
) -> None:
    """将系统 skill 写入 global/skills/{name}/SKILL.md"""
    _write_skill_files(_skill_dir(name), name, description, content, references, mcp_tools)


def write_user_skill(
    user_id: str,
    name: str,
    description: str,
    content: str,
    references: dict[str, str] | None = None,
    mcp_tools: list[str] | None = None,
) -> None:
    """将用户 skill 写入 users/{user_id}/skills/{name}/SKILL.md"""
    _write_skill_files(
        _user_skills_root(user_id) / name, name, description, content, references, mcp_tools,
    )


def _write_skill_files(
    skill_dir: Path,
    name: str,
    description: str,
    content: str,
    references: dict[str, str] | None,
    mcp_tools: list[str] | None = None,
) -> None:
    skill_dir.mkdir(parents=True, exist_ok=True)
    skill_file = skill_dir / "SKILL.md"
    skill_file.write_text(_build_skill_md(name, description, content, mcp_tools), encoding="utf-8")
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


def _skills_root_for_user(user_id: str | None) -> Path:
    if user_id:
        return _user_skills_root(user_id)
    return _GLOBAL_SKILLS_ROOT


def resolve_skill_creator_dir(
    user_id: str | None,
    session_id: str,
    skill_name: str | None,
    draft_name: str | None,
) -> tuple[Path, str]:
    """
    解析 skill-creator 附件目标目录。
    优先 published skill_name → draft.name → _creator/{session_id}。
    返回 (skill_dir_abs, skill_dir_key)。
    """
    root = _skills_root_for_user(user_id)
    name = (skill_name or draft_name or "").strip()
    if name and not _UNSAFE_NAME_RE.search(name) and "/" not in name and name not in (".", ".."):
        skill_dir = root / name
        return skill_dir, name

    sid = session_id.strip()
    if not sid or _UNSAFE_NAME_RE.search(sid) or "/" in sid:
        raise ValueError("无效的 session_id")
    key = f"{_CREATOR_STAGING_DIR}/{sid}"
    return root / _CREATOR_STAGING_DIR / sid, key


def _unique_file(dir_abs: Path, safe_name: str) -> Path:
    dest = dir_abs / safe_name
    if not dest.exists():
        return dest
    stem, suffix = dest.stem, dest.suffix
    index = 1
    while True:
        candidate = dir_abs / f"{stem}_{index}{suffix}"
        if not candidate.exists():
            return candidate
        index += 1


def save_skill_creator_upload(
    user_id: str | None,
    session_id: str,
    skill_name: str | None,
    draft_name: str | None,
    filename: str,
    data: bytes,
) -> dict:
    """
    将附件写入 skill 目录下 uploads/。
    仅存储，不与 Skill 正文融合（后续由对话逻辑处理）。
    """
    if len(data) > MAX_UPLOAD_BYTES:
        raise ValueError(f"文件超过大小限制（{MAX_UPLOAD_BYTES} bytes）")

    safe_name = Path(filename).name
    if not safe_name or safe_name in (".", "..") or _UNSAFE_NAME_RE.search(safe_name):
        raise ValueError("非法文件名")

    skill_dir, skill_key = resolve_skill_creator_dir(user_id, session_id, skill_name, draft_name)
    upload_dir = skill_dir / _UPLOADS_SUBDIR
    upload_dir.mkdir(parents=True, exist_ok=True)

    dest = _unique_file(upload_dir, safe_name)
    dest.write_bytes(data)
    relative_path = f"{_UPLOADS_SUBDIR}/{dest.name}"
    logger.info(
        "skill-creator upload user=%s session=%s skill_dir=%s file=%s size=%d",
        user_id, session_id, skill_key, relative_path, len(data),
    )
    return {
        "filename": dest.name,
        "relative_path": relative_path,
        "stored_path": str(dest),
        "skill_dir": skill_key,
        "size": len(data),
    }
