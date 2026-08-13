"""知识库约定常量。"""

from pi_shared.knowledge_constants import (
    CHAT_UPLOAD_KB_DESCRIPTION,
    CHAT_UPLOAD_KB_NAME,
    is_chat_upload_kb,
)

DOC_STATUS_UPLOADED = "uploaded"
DOC_STATUS_PROCESSING = "processing"
DOC_STATUS_INDEXED = "indexed"
DOC_STATUS_FAILED = "failed"

PHASE1_MD_NAME = "phase1_convert_md_result.md"
PHASE2_TREE_NAME = "phase2_doctree.json"

SYNTHESIS_NODE_ID = "compiled_doc_synthesis"

ALLOWED_EXTENSIONS = {".pdf", ".docx", ".txt", ".md", ".csv", ".xlsx", ".pptx"}
