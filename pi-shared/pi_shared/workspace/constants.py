"""用户 Workspace 约定（admin / gateway 共用）。"""

# 根目录对用户可见的子目录（memory / pi-sessions 仅只读查看）
ROOT_VISIBLE_DIRS = ("skills", "sessions", "files", "memory", "pi-sessions")

# 可读写分区前缀（相对用户根）
WRITABLE_ROOT = "files"

# 会话级文件系统：每个会话自己的这个子目录（sessions/{sid}/workspace）可读写，
# 但 sessions/ 容器本身、以及会话根目录下的其它子目录（home/tmp 等沙盒运行态目录，
# 见 pi-runtime/src/sandbox.ts buildSessionRoot）保持只读，不对外暴露
SESSION_WORKSPACE_SUBDIR = "workspace"

# 只读分区前缀
READONLY_ROOTS = frozenset({"skills", "sessions", "memory", "pi-sessions"})

# 上传大小上限
MAX_UPLOAD_BYTES = 50 * 1024 * 1024

# session 展示名：首条 request 截断长度
SESSION_DISPLAY_REQUEST_MAX_LEN = 40
