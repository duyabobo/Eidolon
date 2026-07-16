"""Workspace 与对话附件共享层。"""

from pi_shared.workspace.chat_document import (
    ChatAttachmentResult,
    KnowledgeUploadResult,
    attachment_event_payload,
    persist_chat_attachment,
)
from pi_shared.workspace.constants import (
    MAX_UPLOAD_BYTES,
    READONLY_ROOTS,
    ROOT_VISIBLE_DIRS,
    SESSION_DISPLAY_REQUEST_MAX_LEN,
    WRITABLE_ROOT,
)
from pi_shared.workspace.fs import (
    WorkspaceError,
    delete_entry,
    ensure_user_workspace,
    is_writable_rel,
    list_directory,
    mkdir,
    open_download,
    resolve_under_user,
    save_session_workspace_upload,
    save_upload,
    sanitize_session_display,
    user_root,
)

__all__ = [
    "ChatAttachmentResult",
    "KnowledgeUploadResult",
    "MAX_UPLOAD_BYTES",
    "READONLY_ROOTS",
    "ROOT_VISIBLE_DIRS",
    "SESSION_DISPLAY_REQUEST_MAX_LEN",
    "WRITABLE_ROOT",
    "WorkspaceError",
    "attachment_event_payload",
    "delete_entry",
    "ensure_user_workspace",
    "is_writable_rel",
    "list_directory",
    "mkdir",
    "open_download",
    "persist_chat_attachment",
    "resolve_under_user",
    "save_session_workspace_upload",
    "save_upload",
    "sanitize_session_display",
    "user_root",
]
