"""
Admin Workspace 适配层：绑定 settings.sandbox_root，委托 pi_shared.workspace。
"""
from __future__ import annotations

from pathlib import Path

from config import settings
from pi_shared.workspace import (
    WorkspaceError,
    delete_entry as _delete_entry,
    list_directory as _list_directory,
    mkdir as _mkdir,
    open_download as _open_download,
    save_session_workspace_upload as _save_session_workspace_upload,
    save_upload as _save_upload,
)

__all__ = [
    "WorkspaceError",
    "delete_entry",
    "list_directory",
    "mkdir",
    "open_download",
    "save_session_workspace_upload",
    "save_upload",
]


def _root() -> str:
    return settings.sandbox_root


def list_directory(
    user_id: str,
    rel_path: str | None,
    session_meta: dict[str, dict] | None = None,
) -> dict:
    return _list_directory(_root(), user_id, rel_path, session_meta=session_meta)


def mkdir(user_id: str, rel_path: str) -> str:
    return _mkdir(_root(), user_id, rel_path)


def save_upload(user_id: str, dir_rel: str, filename: str, data: bytes) -> str:
    return _save_upload(_root(), user_id, dir_rel, filename, data)


def delete_entry(user_id: str, rel_path: str) -> None:
    return _delete_entry(_root(), user_id, rel_path)


def open_download(user_id: str, rel_path: str) -> tuple[Path, str]:
    return _open_download(_root(), user_id, rel_path)


def save_session_workspace_upload(
    user_id: str, session_id: str, filename: str, data: bytes,
) -> dict:
    return _save_session_workspace_upload(_root(), user_id, session_id, filename, data)
