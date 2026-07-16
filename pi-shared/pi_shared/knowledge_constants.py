"""知识库 / LLM-Wiki / 对话附件约定常量。"""

KNOWLEDGE_SCENE_TYPE = "LLM_WIKI_PI"

# batch_process process_type：1 = STANDARD
KNOWLEDGE_BATCH_PROCESS_TYPE = 1

DEFAULT_DATASET_AVATAR = "/icon/logo.svg"

# 对话附件自动入库的知识库（按用户 knowledge_key 隔离）
CHAT_UPLOAD_KB_NAME = "会话附件"
CHAT_UPLOAD_KB_DESCRIPTION = "对话中上传的文档，供后续知识检索使用"


def is_chat_upload_kb(name: str) -> bool:
    return name == CHAT_UPLOAD_KB_NAME
