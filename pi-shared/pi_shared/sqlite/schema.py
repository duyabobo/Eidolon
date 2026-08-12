"""平台统一 SQLite 表结构（单一事实来源）。

CM 架构下所有服务共享同一个本地 SQLite 文件，各服务在各自的 `connect()` 里
都会传入这份完整 schema 执行 `CREATE TABLE IF NOT EXISTS`：谁先启动谁建表，
其余服务幂等跳过，避免表结构分散在 5 个服务里各写一份导致定义漂移。

字段命名与原 MongoDB 文档保持一致，方便对照迁移前的 `services/*_mongo.py`：
- MongoDB 的 `datetime` 字段 → TEXT，存东八区 ISO 字符串（`pi_shared.datetime_cn.format_iso`）
- MongoDB 的 `list`/`dict` 字段 → TEXT，存 JSON（`pi_shared.sqlite.dumps/loads`）
- MongoDB 的 `bool` 字段 → INTEGER（0/1）
"""

SCHEMA_SQL = """
-- 会话（gateway 写入，gateway-sse 只读，admin 读取用于列表 enrichment）
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    conversation_id TEXT,
    status TEXT NOT NULL,
    request TEXT NOT NULL,
    skill_ids TEXT NOT NULL DEFAULT '[]',
    events_snapshot TEXT NOT NULL DEFAULT '[]',
    error TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_created ON sessions(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_conversation ON sessions(conversation_id, created_at);

-- Skill 元数据（system: user_id IS NULL；user: user_id 为具体用户）
CREATE TABLE IF NOT EXISTS skills (
    name TEXT NOT NULL,
    user_id TEXT,
    description TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '[]',
    mcp_tools TEXT NOT NULL DEFAULT '[]',
    hidden INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (name, user_id)
);

-- MCP Server 配置（system: user_id IS NULL；user: 个人 MCP）
CREATE TABLE IF NOT EXISTS mcp_servers (
    name TEXT NOT NULL,
    user_id TEXT,
    url TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    api_key TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (name, user_id)
);

-- 通用单文档配置（原 Mongo "configs" collection：llm / llm_state 等单例文档）
CREATE TABLE IF NOT EXISTS app_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- LLM Provider 配置项
CREATE TABLE IF NOT EXISTS llm_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    base_url TEXT NOT NULL,
    api_key TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL,
    timeout INTEGER NOT NULL DEFAULT 120,
    protocol TEXT NOT NULL DEFAULT 'openai'
);

-- LLM 调用记录
CREATE TABLE IF NOT EXISTS llm_calls (
    llm_id TEXT PRIMARY KEY,
    session_id TEXT,
    question_id TEXT,
    messages TEXT NOT NULL DEFAULT '[]',
    output TEXT,
    stream INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'in_progress',
    error TEXT,
    model TEXT NOT NULL DEFAULT '',
    protocol TEXT NOT NULL DEFAULT 'openai',
    base_url TEXT NOT NULL DEFAULT '',
    request_body TEXT,
    latency_ms INTEGER,
    created_at TEXT NOT NULL,
    completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_llm_calls_created ON llm_calls(created_at);
CREATE INDEX IF NOT EXISTS idx_llm_calls_session ON llm_calls(session_id);
CREATE INDEX IF NOT EXISTS idx_llm_calls_question ON llm_calls(question_id);

-- 本地知识库
CREATE TABLE IF NOT EXISTS knowledge_bases (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL DEFAULT 'document',
    chunking_config TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_documents (
    id TEXT PRIMARY KEY,
    kb_id TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    file_size INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'uploaded',
    error_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_knowledge_documents_kb ON knowledge_documents(kb_id);

CREATE TABLE IF NOT EXISTS knowledge_service_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    base_url TEXT NOT NULL DEFAULT '',
    environment TEXT NOT NULL DEFAULT 'local',
    created_at TEXT NOT NULL
);

-- 任务派发幂等表（替代原 Redis `SET NX` 去重：gateway 派发任务前先查重，
-- 同一 task_id=session_id:turn_id 只会触发一次 pi-runtime 调用）
CREATE TABLE IF NOT EXISTS task_dedupe (
    task_id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL
);

-- 轮次增量事件（替代原 Redis Stream `session:{sid}:turn:{tid}:stream`）。
-- pi-runtime 产生一个 token/tool_call/... 事件即写入一行，seq 单调递增；
-- gateway-sse 按 seq 回放历史 + 实时推送新增行，实现 SSE 断线重传。
CREATE TABLE IF NOT EXISTS turn_events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    turn_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_turn_events_turn ON turn_events(session_id, turn_id, seq);

-- Skill Creator 对话草稿会话
CREATE TABLE IF NOT EXISTS skill_creator_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    skill_name TEXT,
    published INTEGER NOT NULL DEFAULT 0,
    messages TEXT NOT NULL DEFAULT '[]',
    draft TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_skill_creator_user_updated ON skill_creator_sessions(user_id, updated_at);
"""
