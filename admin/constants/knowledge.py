"""知识库外部服务（mRAG）约定常量。"""

from config import settings
from pi_shared.knowledge_constants import (
    CHAT_UPLOAD_KB_DESCRIPTION,
    CHAT_UPLOAD_KB_NAME,
    KNOWLEDGE_BATCH_PROCESS_TYPE,
    KNOWLEDGE_SCENE_TYPE,
    is_chat_upload_kb,
)

# 平台级 scene_uid（管理页知识库操作用）
KNOWLEDGE_PLATFORM_SCENE_UID = "llm_wiki_pi"

DEFAULT_DATASET_AVATAR = "/icon/logo.svg"

KNOWLEDGE_KEY_HEADER = "x-knowledge-key"
SCENE_UID_HEADER = "x-scene-uid"

KNOWLEDGE_ENVIRONMENT_LABELS = {
    "local": "本地",
    "prod": "线上",
    "test": "测试",
}


def knowledge_environment_urls() -> dict[str, str]:
    return {
        "local": settings.knowledge_local_base_url.rstrip("/"),
        "prod": settings.knowledge_prod_base_url.rstrip("/"),
        "test": settings.knowledge_test_base_url.rstrip("/"),
    }
