"""本机插件文件系统：users/{uid}/plugins/{name}/ 或 global/plugins/{name}/。"""
from __future__ import annotations

import logging
import re
import shutil
from pathlib import Path

from cm_server.admin.config import settings

logger = logging.getLogger(__name__)

PLUGIN_SERVER_FILE = "server.py"
PLUGIN_META_FILE = "PLUGIN.md"
_UNSAFE_NAME_RE = re.compile(r'[/\\\0:*?"<>|]')
_CREATOR_STAGING_DIR = "_creator"


def _safe_name(name: str) -> str:
    cleaned = (name or "").strip()
    if not cleaned or _UNSAFE_NAME_RE.search(cleaned) or "/" in cleaned or cleaned in {".", ".."}:
        raise ValueError("插件名称不合法")
    return cleaned


def _root_for_user(user_id: str | None) -> Path:
    if user_id:
        return Path(settings.sandbox_root) / "users" / user_id / "plugins"
    return Path(settings.sandbox_root) / "global" / "plugins"


def plugin_dir(name: str, user_id: str | None) -> Path:
    return _root_for_user(user_id) / _safe_name(name)


def read_plugin(name: str, user_id: str | None) -> tuple[str, str] | None:
    """返回 (description, server_py)；目录或入口不存在则 None。"""
    dest = plugin_dir(name, user_id)
    server = dest / PLUGIN_SERVER_FILE
    if not server.is_file():
        return None
    description = ""
    meta = dest / PLUGIN_META_FILE
    if meta.is_file():
        for line in meta.read_text(encoding="utf-8").splitlines():
            if line.startswith("description:"):
                description = line.split(":", 1)[1].strip()
                break
    return description, server.read_text(encoding="utf-8")


def write_plugin(name: str, description: str, server_py: str, user_id: str | None) -> Path:
    safe = _safe_name(name)
    dest = plugin_dir(safe, user_id)
    dest.mkdir(parents=True, exist_ok=True)
    meta = "\n".join([
        "---",
        f"name: {safe}",
        f"description: {description.strip()}",
        "transport: stdio",
        "---",
        "",
        "本机 MCP 插件，由对话创建器生成，经 mcp-proxy 提供给 Agent。",
        "",
    ])
    (dest / PLUGIN_META_FILE).write_text(meta, encoding="utf-8")
    (dest / PLUGIN_SERVER_FILE).write_text(server_py.strip() + "\n", encoding="utf-8")
    logger.info("插件已写入 dir=%s", dest)
    return dest


def delete_plugin(name: str, user_id: str | None) -> bool:
    dest = plugin_dir(name, user_id)
    if not dest.exists():
        return False
    shutil.rmtree(dest)
    logger.info("插件目录已删除 dir=%s", dest)
    return True


def resolve_creator_dir(
    user_id: str | None,
    session_id: str,
    plugin_name: str | None,
    draft_name: str | None,
) -> tuple[Path, str]:
    root = _root_for_user(user_id)
    name = (plugin_name or draft_name or "").strip()
    if name and not _UNSAFE_NAME_RE.search(name) and "/" not in name and name not in {".", ".."}:
        return root / name, name
    sid = session_id.strip()
    if not sid or _UNSAFE_NAME_RE.search(sid) or "/" in sid:
        raise ValueError("无效的 session_id")
    return root / _CREATOR_STAGING_DIR / sid, f"{_CREATOR_STAGING_DIR}/{sid}"


def sync_plugin_draft_to_disk(
    *,
    user_id: str | None,
    session_id: str,
    plugin_name: str | None,
    draft_name: str | None,
    name: str,
    description: str,
    server_py: str,
) -> str:
    dest, key = resolve_creator_dir(user_id, session_id, plugin_name, draft_name)
    dest.mkdir(parents=True, exist_ok=True)
    meta = "\n".join([
        "---",
        f"name: {name.strip()}",
        f"description: {description.strip()}",
        "transport: stdio",
        "---",
        "",
        "本机 MCP 插件草稿。",
        "",
    ])
    (dest / PLUGIN_META_FILE).write_text(meta, encoding="utf-8")
    (dest / PLUGIN_SERVER_FILE).write_text(server_py.strip() + "\n", encoding="utf-8")
    logger.info("插件草稿已同步 dir=%s", dest)
    return key


def list_creator_tree(
    *,
    user_id: str | None,
    session_id: str,
    plugin_name: str | None,
    draft_name: str | None,
) -> dict:
    dest, key = resolve_creator_dir(user_id, session_id, plugin_name, draft_name)
    entries: list[dict] = []
    if dest.is_dir():
        for path in sorted(dest.rglob("*")):
            rel = path.relative_to(dest).as_posix()
            if not rel or any(part.startswith(".") for part in Path(rel).parts):
                continue
            entries.append({
                "path": rel,
                "name": path.name,
                "is_dir": path.is_dir(),
                "size": 0 if path.is_dir() else path.stat().st_size,
            })
    return {"session_id": session_id, "skill_dir": key, "entries": entries}


def open_creator_file(
    *,
    user_id: str | None,
    session_id: str,
    plugin_name: str | None,
    draft_name: str | None,
    rel_path: str,
) -> tuple[Path, str] | None:
    dest, _ = resolve_creator_dir(user_id, session_id, plugin_name, draft_name)
    cleaned = (rel_path or "").replace("\\", "/").strip().lstrip("/")
    if not cleaned or ".." in Path(cleaned).parts:
        return None
    target = (dest / cleaned).resolve()
    try:
        target.relative_to(dest.resolve())
    except ValueError:
        return None
    if not target.is_file():
        return None
    return target, target.name
