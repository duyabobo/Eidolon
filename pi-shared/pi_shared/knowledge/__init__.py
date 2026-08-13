"""知识库共享常量与类型（远程 mRAG 客户端已移除，统一走 cm-server 本地知识库）。"""

from pi_shared.knowledge_constants import (
    CHAT_UPLOAD_KB_DESCRIPTION,
    CHAT_UPLOAD_KB_NAME,
    is_chat_upload_kb,
)

__all__ = [
    "CHAT_UPLOAD_KB_DESCRIPTION",
    "CHAT_UPLOAD_KB_NAME",
    "is_chat_upload_kb",
]
