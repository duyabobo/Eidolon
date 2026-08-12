"""
用户 Workspace 文件系统（admin / gateway 共用）。

结构：
  {sandbox_root}/users/{user_id}/
    skills/      只读
    sessions/    只读（磁盘为 UUID；展示名由本地 SQLite enrichment）
    files/       可读写
    memory/      只读（MEMORY.md）
    pi-sessions/ 只读（pi 对话 JSONL）
"""
from __future__ import annotations

import logging
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path

from pi_shared.workspace.constants import (
    MAX_UPLOAD_BYTES,
    READONLY_ROOTS,
    ROOT_VISIBLE_DIRS,
    SESSION_DISPLAY_REQUEST_MAX_LEN,
    WRITABLE_ROOT,
)

logger = logging.getLogger(__name__)

_UNSAFE_NAME_RE = re.compile(r'[/\\\0:*?"<>|]')
_DOT_ENTRIES = (".", "..")


class WorkspaceError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def user_root(sandbox_root: str | Path, user_id: str) -> Path:
    uid = user_id.strip()
    if not uid or uid in (".", "..") or "/" in uid or "\\" in uid:
        raise WorkspaceError("无效的 user_id", 400)
    return Path(sandbox_root) / "users" / uid


def ensure_user_workspace(sandbox_root: str | Path, user_id: str) -> Path:
    """确保用户根与可见子目录存在（幂等）。"""
    root = user_root(sandbox_root, user_id)
    root.mkdir(parents=True, exist_ok=True)
    for name in ROOT_VISIBLE_DIRS:
        (root / name).mkdir(parents=True, exist_ok=True)
    return root


def normalize_rel_path(path: str | None) -> str:
    raw = (path or "").strip()
    if not raw or raw == ".":
        return ""
    if raw.startswith("/") or raw.startswith("\\"):
        raise WorkspaceError("路径不能为绝对路径", 400)
    parts: list[str] = []
    for part in raw.replace("\\", "/").split("/"):
        if part in ("", "."):
            continue
        if part == "..":
            if not parts:
                raise WorkspaceError("路径越界", 400)
            parts.pop()
            continue
        if _UNSAFE_NAME_RE.search(part) or part in (".", ".."):
            raise WorkspaceError(f"非法路径段: {part}", 400)
        parts.append(part)
    return "/".join(parts)


def resolve_under_user(
    sandbox_root: str | Path, user_id: str, rel_path: str,
) -> tuple[Path, str]:
    root = ensure_user_workspace(sandbox_root, user_id)
    rel = normalize_rel_path(rel_path)
    target = (root / rel).resolve() if rel else root.resolve()
    root_real = root.resolve()
    try:
        target.relative_to(root_real)
    except ValueError as exc:
        raise WorkspaceError("路径越界：禁止访问其他用户目录", 403) from exc
    return target, rel


def is_writable_rel(rel_path: str) -> bool:
    if not rel_path:
        return False
    first = rel_path.split("/", 1)[0]
    return first == WRITABLE_ROOT


def require_writable(rel_path: str) -> None:
    if not is_writable_rel(rel_path):
        raise WorkspaceError("该路径为只读区域，禁止写入", 403)


def parent_rel(rel_path: str) -> str:
    if not rel_path:
        return ""
    if "/" not in rel_path:
        return ""
    return rel_path.rsplit("/", 1)[0]


def _mtime_dt(stat_mtime: float) -> datetime:
    return datetime.fromtimestamp(stat_mtime, tz=timezone.utc)


def sanitize_session_display(request: str, created_at: datetime | None) -> str:
    text = (request or "").strip().replace("\n", " ").replace("\r", " ")
    text = _UNSAFE_NAME_RE.sub("_", text)
    text = re.sub(r"\s+", " ", text).strip(" ._")
    if len(text) > SESSION_DISPLAY_REQUEST_MAX_LEN:
        text = text[:SESSION_DISPLAY_REQUEST_MAX_LEN].rstrip(" ._")
    if not text:
        text = "session"
    if created_at is None:
        return text
    ts = created_at.astimezone().strftime("%Y%m%d_%H%M%S")
    return f"{text}_{ts}"


def build_dot_entries(rel_path: str, writable: bool) -> list[dict]:
    parent = parent_rel(rel_path)
    return [
        {
            "name": ".",
            "display_name": ".",
            "path": rel_path,
            "is_dir": True,
            "size": 0,
            "mtime": None,
            "readonly": not writable,
        },
        {
            "name": "..",
            "display_name": "..",
            "path": parent,
            "is_dir": True,
            "size": 0,
            "mtime": None,
            "readonly": not is_writable_rel(parent) if parent else True,
        },
    ]


def list_directory(
    sandbox_root: str | Path,
    user_id: str,
    rel_path: str | None,
    session_meta: dict[str, dict] | None = None,
) -> dict:
    abs_path, rel = resolve_under_user(sandbox_root, user_id, rel_path or "")
    if not abs_path.exists():
        raise WorkspaceError("路径不存在", 404)
    if not abs_path.is_dir():
        raise WorkspaceError("目标不是目录", 400)

    writable = is_writable_rel(rel)
    entries = build_dot_entries(rel, writable)

    if rel == "":
        for name in ROOT_VISIBLE_DIRS:
            child = abs_path / name
            if not child.exists():
                child.mkdir(parents=True, exist_ok=True)
            st = child.stat()
            entries.append(
                {
                    "name": name,
                    "display_name": name,
                    "path": name,
                    "is_dir": True,
                    "size": 0,
                    "mtime": _mtime_dt(st.st_mtime),
                    "readonly": name in READONLY_ROOTS,
                }
            )
        logger.info("workspace ls root user=%s entries=%d", user_id, len(entries) - 2)
        return {"path": rel, "writable": False, "entries": entries}

    if rel == "sessions":
        meta = session_meta or {}
        children = sorted(
            (p for p in abs_path.iterdir() if p.is_dir() and not p.name.startswith(".")),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        for child in children:
            sid = child.name
            info = meta.get(sid, {})
            display = sanitize_session_display(
                str(info.get("request") or sid),
                info.get("created_at"),
            )
            st = child.stat()
            target_rel = f"sessions/{sid}/workspace"
            workspace_path = abs_path / sid / "workspace"
            if not workspace_path.exists():
                workspace_path.mkdir(parents=True, exist_ok=True)
            entries.append(
                {
                    "name": sid,
                    "display_name": display,
                    "path": target_rel,
                    "is_dir": True,
                    "size": 0,
                    "mtime": _mtime_dt(st.st_mtime),
                    "readonly": True,
                }
            )
        logger.info("workspace ls sessions user=%s count=%d", user_id, len(children))
        return {"path": rel, "writable": False, "entries": entries}

    children = sorted(abs_path.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
    for child in children:
        child_rel = f"{rel}/{child.name}" if rel else child.name
        try:
            st = child.stat()
        except OSError:
            continue
        entries.append(
            {
                "name": child.name,
                "display_name": child.name,
                "path": child_rel,
                "is_dir": child.is_dir(),
                "size": 0 if child.is_dir() else st.st_size,
                "mtime": _mtime_dt(st.st_mtime),
                "readonly": not is_writable_rel(child_rel),
            }
        )

    logger.info("workspace ls user=%s path=%s count=%d", user_id, rel, len(entries) - 2)
    return {"path": rel, "writable": writable, "entries": entries}


def mkdir(sandbox_root: str | Path, user_id: str, rel_path: str) -> str:
    abs_path, rel = resolve_under_user(sandbox_root, user_id, rel_path)
    require_writable(rel)
    if abs_path.exists():
        raise WorkspaceError("路径已存在", 409)
    abs_path.mkdir(parents=True, exist_ok=False)
    logger.info("workspace mkdir user=%s path=%s", user_id, rel)
    return rel


def save_upload(
    sandbox_root: str | Path, user_id: str, dir_rel: str, filename: str, data: bytes,
) -> str:
    if len(data) > MAX_UPLOAD_BYTES:
        raise WorkspaceError(f"文件超过大小限制（{MAX_UPLOAD_BYTES} bytes）", 413)

    safe_name = Path(filename).name
    if not safe_name or safe_name in _DOT_ENTRIES or _UNSAFE_NAME_RE.search(safe_name):
        raise WorkspaceError("非法文件名", 400)

    dir_abs, dir_norm = resolve_under_user(sandbox_root, user_id, dir_rel)
    require_writable(dir_norm)
    if not dir_abs.exists():
        raise WorkspaceError("目标目录不存在", 404)
    if not dir_abs.is_dir():
        raise WorkspaceError("目标不是目录", 400)

    dest_rel = f"{dir_norm}/{safe_name}" if dir_norm else safe_name
    require_writable(dest_rel)
    dest_abs, _ = resolve_under_user(sandbox_root, user_id, dest_rel)
    if dest_abs.exists():
        raise WorkspaceError("文件已存在", 409)

    dest_abs.write_bytes(data)
    logger.info("workspace upload user=%s path=%s size=%d", user_id, dest_rel, len(data))
    return dest_rel


def delete_entry(sandbox_root: str | Path, user_id: str, rel_path: str) -> None:
    abs_path, rel = resolve_under_user(sandbox_root, user_id, rel_path)
    require_writable(rel)
    if rel == WRITABLE_ROOT:
        raise WorkspaceError("不能删除 files 根目录", 403)
    if not abs_path.exists():
        raise WorkspaceError("路径不存在", 404)
    if abs_path.is_dir():
        shutil.rmtree(abs_path)
    else:
        abs_path.unlink()
    logger.info("workspace delete user=%s path=%s", user_id, rel)


def open_download(sandbox_root: str | Path, user_id: str, rel_path: str) -> tuple[Path, str]:
    abs_path, rel = resolve_under_user(sandbox_root, user_id, rel_path)
    if not abs_path.exists():
        raise WorkspaceError("路径不存在", 404)
    if abs_path.is_dir():
        raise WorkspaceError("不能下载目录", 400)
    top = rel.split("/", 1)[0] if rel else ""
    if top not in ROOT_VISIBLE_DIRS:
        raise WorkspaceError("禁止下载该路径", 403)
    return abs_path, abs_path.name


def _safe_filename(filename: str) -> str:
    safe_name = Path(filename).name
    if not safe_name or safe_name in _DOT_ENTRIES or _UNSAFE_NAME_RE.search(safe_name):
        raise WorkspaceError("非法文件名", 400)
    return safe_name


def _unique_dest(dir_abs: Path, safe_name: str) -> Path:
    dest = dir_abs / safe_name
    if not dest.exists():
        return dest
    stem = dest.stem
    suffix = dest.suffix
    index = 1
    while True:
        candidate = dir_abs / f"{stem}_{index}{suffix}"
        if not candidate.exists():
            return candidate
        index += 1


def save_session_workspace_upload(
    sandbox_root: str | Path,
    user_id: str,
    session_id: str,
    filename: str,
    data: bytes,
) -> dict:
    """写入 users/{uid}/sessions/{sid}/workspace/{filename}。"""
    if len(data) > MAX_UPLOAD_BYTES:
        raise WorkspaceError(f"文件超过大小限制（{MAX_UPLOAD_BYTES} bytes）", 413)

    sid = (session_id or "").strip()
    if not sid or "/" in sid or "\\" in sid or sid in _DOT_ENTRIES:
        raise WorkspaceError("无效的 session_id", 400)

    safe_name = _safe_filename(filename)
    dir_rel = f"sessions/{sid}/workspace"
    dir_abs, _ = resolve_under_user(sandbox_root, user_id, dir_rel)
    dir_abs.mkdir(parents=True, exist_ok=True)

    dest_abs = _unique_dest(dir_abs, safe_name)
    dest_abs.write_bytes(data)
    relative_path = dest_abs.name
    stored_path = str(dest_abs)
    logger.info(
        "session workspace upload user=%s session=%s file=%s size=%d",
        user_id, sid, relative_path, len(data),
    )
    return {
        "filename": relative_path,
        "relative_path": relative_path,
        "stored_path": stored_path,
        "size": len(data),
    }
