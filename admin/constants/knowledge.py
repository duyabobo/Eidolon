"""知识库外部服务（mRAG）约定常量。"""

from config import settings
from pi_shared.knowledge_constants import KNOWLEDGE_SCENE_TYPE

# 用户注册 scene_type（POST /dataset/get_or_create_knowledge_key）

# 平台级 scene_uid（管理页知识库操作用）
KNOWLEDGE_PLATFORM_SCENE_UID = "llm_wiki_pi"

# batch_process process_type：1 = STANDARD（MinerU 解析 + 理解流水线 + LLM-Wiki 入库）
KNOWLEDGE_BATCH_PROCESS_TYPE = 1

DEFAULT_DATASET_AVATAR = "/icon/logo.svg"

KNOWLEDGE_KEY_HEADER = "x-knowledge-key"
SCENE_UID_HEADER = "x-scene-uid"

# 对话附件自动入库的知识库（按用户 knowledge_key 隔离）
CHAT_UPLOAD_KB_NAME = "会话附件"
CHAT_UPLOAD_KB_DESCRIPTION = "对话中上传的文档，供后续知识检索使用"


def is_chat_upload_kb(name: str) -> bool:
    """系统内部知识库：不在 Knowledge 管理页展示。"""
    return name == CHAT_UPLOAD_KB_NAME


KNOWLEDGE_ENVIRONMENT_LABELS = {
    "local": "本地",
    "prod": "线上",
    "test": "测试",
}


def knowledge_environment_urls() -> dict[str, str]:
    return {
        "prod": settings.knowledge_prod_base_url.rstrip("/"),
        "test": settings.knowledge_test_base_url.rstrip("/"),
    }
