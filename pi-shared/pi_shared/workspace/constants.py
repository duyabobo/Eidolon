"""用户 Workspace 约定（admin / gateway / runtime 语义对齐）。"""

# 根目录对用户可见的子目录（pi-sessions = 会话 JSONL；memory = 用户级长期记忆）
ROOT_VISIBLE_DIRS = ("skills", "sessions", "files", "pi-sessions", "memory")

# 可读写分区前缀（相对用户根）
WRITABLE_ROOT = "files"

# 会话附件编译出的 wiki node：users/{uid}/files/wiki/，跨 session 共享
USER_WIKI_SUBDIR = "wiki"

# 会话级文件系统根：sessions/{sid}/workspace
SESSION_WORKSPACE_SUBDIR = "workspace"

# 会话 workspace 下分区
SESSION_ZONE_ARTIFACTS = "artifacts"  # 对话/Agent 产物：用户只读（预览/下载）
SESSION_ZONE_UPLOADS = "uploads"  # 用户主动上传：可上传/删除，走 parse/understand
SESSION_WORKSPACE_ZONES = (
    SESSION_ZONE_ARTIFACTS,
    SESSION_ZONE_UPLOADS,
)

# 用户 API 仅允许写入 uploads 分区（含其子目录）
SESSION_USER_WRITABLE_ZONE = SESSION_ZONE_UPLOADS

# UI / 列表展示名
SESSION_ZONE_DISPLAY_NAMES = {
    SESSION_ZONE_ARTIFACTS: "对话产物",
    SESSION_ZONE_UPLOADS: "用户上传",
}

# 只读分区前缀（用户根级）
READONLY_ROOTS = frozenset({"skills", "sessions", "pi-sessions", "memory"})

# 上传大小上限
MAX_UPLOAD_BYTES = 50 * 1024 * 1024

# session 展示名：首条 request 截断长度
SESSION_DISPLAY_REQUEST_MAX_LEN = 40
