"""用户 Workspace 文件管理器约定。"""

# 根目录对用户可见的子目录（隐藏 memory / pi-sessions 等内部实现）
ROOT_VISIBLE_DIRS = ("skills", "sessions", "files")

# 可读写分区前缀（相对用户根）
WRITABLE_ROOT = "files"

# 只读分区前缀
READONLY_ROOTS = frozenset({"skills", "sessions"})

# 上传大小上限
MAX_UPLOAD_BYTES = 50 * 1024 * 1024

# session 展示名：首条 request 截断长度
SESSION_DISPLAY_REQUEST_MAX_LEN = 40
