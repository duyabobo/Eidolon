"""
路径解析与权限判定（纯逻辑，不读业务目录内容）。

会话 workspace 相对路径形态：
  sessions/{sid}/workspace[/{zone}[/...]]
"""
from __future__ import annotations

import re
from datetime import datetime
from pathlib import Path

from pi_shared.workspace.constants import (
    ROOT_VISIBLE_DIRS,
    SESSION_DISPLAY_REQUEST_MAX_LEN,
    SESSION_USER_WRITABLE_ZONE,
    SESSION_WORKSPACE_SUBDIR,
    SESSION_WORKSPACE_ZONES,
    USER_WIKI_SUBDIR,
    WRITABLE_ROOT,
)
from pi_shared.workspace.errors import WorkspaceError

_UNSAFE_NAME_RE = re.compile(r'[/\\\0:*?"<>|]')
_DOT_ENTRIES = (".", "..")

# sessions / {sid} / workspace → 至少 3 段
_SESSION_WS_MIN_PARTS = 3
# sessions / {sid} / workspace / {zone} → 4 段
_SESSION_ZONE_PARTS = 4


def user_root(sandbox_root: str | Path, user_id: str) -> Path:
    uid = user_id.strip()
    if not uid or uid in _DOT_ENTRIES or "/" in uid or "\\" in uid:
        raise WorkspaceError("无效的 user_id", 400)
    return Path(sandbox_root) / "users" / uid


def user_files_wiki_dir(sandbox_root: str | Path, user_id: str) -> Path:
    """跨会话可读的用户公共 wiki 目录：users/{uid}/files/wiki。"""
    return user_root(sandbox_root, user_id) / WRITABLE_ROOT / USER_WIKI_SUBDIR


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
        if _UNSAFE_NAME_RE.search(part) or part in _DOT_ENTRIES:
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


def session_workspace_root_rel(session_id: str) -> str:
    return f"sessions/{session_id}/{SESSION_WORKSPACE_SUBDIR}"


def session_workspace_rel_parts(rel_path: str) -> list[str] | None:
    """若 rel_path 落在会话 workspace 子树内，返回按 "/" 拆分的分段；否则 None。"""
    if not rel_path:
        return None
    parts = rel_path.split("/")
    if (
        len(parts) >= _SESSION_WS_MIN_PARTS
        and parts[0] == "sessions"
        and parts[2] == SESSION_WORKSPACE_SUBDIR
    ):
        return parts
    return None


def session_workspace_abs_from_parts(abs_path: Path, parts: list[str]) -> Path:
    """从任意 workspace 子路径回溯到 sessions/{sid}/workspace 绝对路径。"""
    workspace_abs = abs_path
    for _ in range(len(parts) - _SESSION_WS_MIN_PARTS):
        workspace_abs = workspace_abs.parent
    return workspace_abs


def ensure_session_workspace_zones(workspace_abs: Path) -> None:
    """确保会话 workspace 分区存在（artifacts / uploads）。"""
    workspace_abs.mkdir(parents=True, exist_ok=True)
    for zone in SESSION_WORKSPACE_ZONES:
        (workspace_abs / zone).mkdir(parents=True, exist_ok=True)


def is_writable_rel(rel_path: str) -> bool:
    if not rel_path:
        return False
    first = rel_path.split("/", 1)[0]
    if first == WRITABLE_ROOT:
        return True
    parts = session_workspace_rel_parts(rel_path)
    if parts is None:
        return False
    # sessions/{sid}/workspace/uploads[/...]
    return len(parts) >= _SESSION_ZONE_PARTS and parts[3] == SESSION_USER_WRITABLE_ZONE


def require_writable(rel_path: str) -> None:
    if not is_writable_rel(rel_path):
        raise WorkspaceError("该路径为只读区域，禁止写入", 403)


def parent_rel(rel_path: str) -> str:
    if not rel_path or "/" not in rel_path:
        return ""
    return rel_path.rsplit("/", 1)[0]


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


def safe_filename(filename: str) -> str:
    safe_name = Path(filename).name
    if not safe_name or safe_name in _DOT_ENTRIES or _UNSAFE_NAME_RE.search(safe_name):
        raise WorkspaceError("非法文件名", 400)
    return safe_name


def validate_session_id(session_id: str) -> str:
    sid = (session_id or "").strip()
    if not sid or "/" in sid or "\\" in sid or sid in _DOT_ENTRIES:
        raise WorkspaceError("无效的 session_id", 400)
    return sid


def is_session_workspace_root(rel_path: str) -> bool:
    parts = session_workspace_rel_parts(rel_path)
    return parts is not None and len(parts) == _SESSION_WS_MIN_PARTS


def is_session_zone_root(rel_path: str) -> bool:
    parts = session_workspace_rel_parts(rel_path)
    return (
        parts is not None
        and len(parts) == _SESSION_ZONE_PARTS
        and parts[3] in SESSION_WORKSPACE_ZONES
    )


def is_session_uploads_rel(rel_path: str) -> bool:
    """sessions/{sid}/workspace/uploads 及其子路径（用户上传，走 wiki 解析）。"""
    parts = session_workspace_rel_parts(rel_path)
    return (
        parts is not None
        and len(parts) >= _SESSION_ZONE_PARTS
        and parts[3] == SESSION_USER_WRITABLE_ZONE
    )
