"""目录列表：用户根 / sessions / 会话分区 / 普通目录。"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from pathlib import Path

from pi_shared.workspace.constants import (
    READONLY_ROOTS,
    ROOT_VISIBLE_DIRS,
    SESSION_WORKSPACE_SUBDIR,
    SESSION_WORKSPACE_ZONES,
    SESSION_ZONE_DISPLAY_NAMES,
)
from pi_shared.workspace.errors import WorkspaceError
from pi_shared.workspace.paths import (
    ensure_session_workspace_zones,
    is_session_workspace_root,
    is_writable_rel,
    parent_rel,
    resolve_under_user,
    sanitize_session_display,
    session_workspace_abs_from_parts,
    session_workspace_rel_parts,
    session_workspace_root_rel,
)

logger = logging.getLogger(__name__)


def _mtime_dt(stat_mtime: float) -> datetime:
    return datetime.fromtimestamp(stat_mtime, tz=timezone.utc)


def _entry(
    *,
    name: str,
    path: str,
    is_dir: bool,
    size: int,
    mtime: datetime | None,
    readonly: bool,
    display_name: str | None = None,
) -> dict:
    return {
        "name": name,
        "display_name": display_name if display_name is not None else name,
        "path": path,
        "is_dir": is_dir,
        "size": size,
        "mtime": mtime,
        "readonly": readonly,
    }


def _build_dot_entries(rel_path: str, writable: bool) -> list[dict]:
    parent = parent_rel(rel_path)
    return [
        _entry(
            name=".",
            path=rel_path,
            is_dir=True,
            size=0,
            mtime=None,
            readonly=not writable,
        ),
        _entry(
            name="..",
            path=parent,
            is_dir=True,
            size=0,
            mtime=None,
            readonly=not is_writable_rel(parent) if parent else True,
        ),
    ]


def _list_user_root(abs_path: Path, entries: list[dict], user_id: str) -> dict:
    for name in ROOT_VISIBLE_DIRS:
        child = abs_path / name
        if not child.exists():
            child.mkdir(parents=True, exist_ok=True)
        st = child.stat()
        entries.append(
            _entry(
                name=name,
                path=name,
                is_dir=True,
                size=0,
                mtime=_mtime_dt(st.st_mtime),
                readonly=name in READONLY_ROOTS,
            )
        )
    logger.info("workspace ls root user=%s entries=%d", user_id, len(entries) - 2)
    return {"path": "", "writable": False, "entries": entries}


def _list_sessions(
    abs_path: Path,
    entries: list[dict],
    user_id: str,
    session_meta: dict[str, dict] | None,
) -> dict:
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
        target_rel = session_workspace_root_rel(sid)
        ensure_session_workspace_zones(abs_path / sid / SESSION_WORKSPACE_SUBDIR)
        entries.append(
            _entry(
                name=sid,
                path=target_rel,
                is_dir=True,
                size=0,
                mtime=_mtime_dt(st.st_mtime),
                readonly=True,
                display_name=display,
            )
        )
    logger.info("workspace ls sessions user=%s count=%d", user_id, len(children))
    return {"path": "sessions", "writable": False, "entries": entries}


def _list_session_zones(abs_path: Path, rel: str, entries: list[dict], user_id: str) -> dict:
    """列出 workspace 根：分区目录（带展示名）+ 根下其它文件，避免只剩空的 artifacts 套娃。"""
    zone_names = set(SESSION_WORKSPACE_ZONES)
    for zone in SESSION_WORKSPACE_ZONES:
        child = abs_path / zone
        st = child.stat()
        child_rel = f"{rel}/{zone}"
        entries.append(
            _entry(
                name=zone,
                path=child_rel,
                is_dir=True,
                size=0,
                mtime=_mtime_dt(st.st_mtime),
                readonly=not is_writable_rel(child_rel),
                display_name=SESSION_ZONE_DISPLAY_NAMES.get(zone, zone),
            )
        )
    extras = 0
    children = sorted(abs_path.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
    for child in children:
        if child.name.startswith(".") or child.name in zone_names:
            continue
        child_rel = f"{rel}/{child.name}"
        try:
            st = child.stat()
        except OSError:
            continue
        extras += 1
        entries.append(
            _entry(
                name=child.name,
                path=child_rel,
                is_dir=child.is_dir(),
                size=0 if child.is_dir() else st.st_size,
                mtime=_mtime_dt(st.st_mtime),
                readonly=not is_writable_rel(child_rel),
            )
        )
    logger.info("workspace ls session root user=%s path=%s extras=%d", user_id, rel, extras)
    return {"path": rel, "writable": False, "entries": entries}


def _list_generic(abs_path: Path, rel: str, entries: list[dict], user_id: str, writable: bool) -> dict:
    children = sorted(abs_path.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
    for child in children:
        if child.name.startswith("."):
            continue
        child_rel = f"{rel}/{child.name}" if rel else child.name
        try:
            st = child.stat()
        except OSError:
            continue
        entries.append(
            _entry(
                name=child.name,
                path=child_rel,
                is_dir=child.is_dir(),
                size=0 if child.is_dir() else st.st_size,
                mtime=_mtime_dt(st.st_mtime),
                readonly=not is_writable_rel(child_rel),
            )
        )
    logger.info("workspace ls user=%s path=%s count=%d", user_id, rel, len(entries) - 2)
    return {"path": rel, "writable": writable, "entries": entries}


def list_directory(
    sandbox_root: str | Path,
    user_id: str,
    rel_path: str | None,
    session_meta: dict[str, dict] | None = None,
) -> dict:
    abs_path, rel = resolve_under_user(sandbox_root, user_id, rel_path or "")
    session_ws_parts = session_workspace_rel_parts(rel)
    if session_ws_parts is not None:
        ensure_session_workspace_zones(
            session_workspace_abs_from_parts(abs_path, session_ws_parts),
        )
    if not abs_path.exists():
        raise WorkspaceError("路径不存在", 404)
    if not abs_path.is_dir():
        raise WorkspaceError("目标不是目录", 400)

    writable = is_writable_rel(rel)
    entries = _build_dot_entries(rel, writable)

    if rel == "":
        return _list_user_root(abs_path, entries, user_id)
    if rel == "sessions":
        return _list_sessions(abs_path, entries, user_id, session_meta)
    if is_session_workspace_root(rel):
        return _list_session_zones(abs_path, rel, entries, user_id)
    return _list_generic(abs_path, rel, entries, user_id, writable)
