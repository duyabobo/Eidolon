"""知识库外部服务（mRAG）约定常量。"""

# 用户注册 scene_type（POST /dataset/get_or_create_knowledge_key）
KNOWLEDGE_SCENE_TYPE = "LLM_WIKI_PI"

# 平台级 scene_uid（管理页知识库操作用）
KNOWLEDGE_PLATFORM_SCENE_UID = "llm_wiki_pi"

# batch_process process_type：1 = STANDARD（MinerU 解析 + 理解流水线 + LLM-Wiki 入库）
KNOWLEDGE_BATCH_PROCESS_TYPE = 1

DEFAULT_DATASET_AVATAR = "/icon/logo.svg"

MRAG_KEY_COLLECTION = "knowledge_mrag_keys"
