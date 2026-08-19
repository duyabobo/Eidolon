"""CM 单进程合并后的统一配置。

原 gateway/gateway-sse/admin/llm-proxy/mcp-proxy 五个服务各自的 Settings 已合并到这一个
类里：字段名有重叠的（sqlite_path、sandbox_root、mcp_proxy_base_url、llm_proxy_base_url）
只保留一份；每个服务原本独立的监听端口（GATEWAY_PORT/ADMIN_PORT/...）不再需要，全部合并
成 CM_SERVER_HOST/CM_SERVER_PORT 一个监听地址。

mcp_proxy_base_url / llm_proxy_base_url 在合并前指向独立容器（如 http://mcp-proxy:8080），
合并后 mcp-proxy / llm-proxy 的路由已经和 gateway/admin 跑在同一个进程、同一个端口里，
这两个字段默认回环到本进程自己的端口，调用方式仍是 httpx 发 HTTP 请求（不是进程内直接
调函数）——保留现有 httpx 调用代码不变，只改 base_url，是本次合并里风险最低的方式；
如果后续要彻底去掉这层回环 HTTP，需要单独评估每个调用点的请求头/用户上下文传递方式。
"""
from pi_shared.sqlite import default_local_db_path
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    cm_server_host: str = "0.0.0.0"
    cm_server_port: int = 8000

    # 本地 SQLite 文件：合并前 5 个服务已经共享同一个文件（同一份 SCHEMA_SQL），
    # 合并后只需一个连接，见 cm_server/shared/db.py
    sqlite_path: str = default_local_db_path()

    # 共享文件系统根目录（workspace / global skills / plugins，与 pi-runtime 共享）
    sandbox_root: str = "/data/sandboxes"
    # 本机插件 stdio 用的 Python；空则自动解析（优先 SANDBOX_PYTHON_BIN_DIR，否则当前解释器）
    plugin_python: str = ""

    # pi-runtime 仍是独立 Node 进程（沙盒需要独立于 Python 主进程），HTTP 调用不变
    pi_runtime_base_url: str = "http://pi-runtime:8090"

    # mcp-proxy / llm-proxy 的路由已合并进本进程，默认回环调用自己
    @property
    def mcp_proxy_base_url(self) -> str:
        return f"http://127.0.0.1:{self.cm_server_port}"

    @property
    def llm_proxy_base_url(self) -> str:
        return f"http://127.0.0.1:{self.cm_server_port}"

    # ===== llm-proxy：真实 LLM provider 配置（env 作为默认值，数据库配置优先） =====
    llm_base_url: str = "https://api.openai.com/v1"
    llm_api_key: str = ""
    llm_model: str = "gpt-4o"
    llm_timeout: int = 120

    # ===== mcp-proxy =====
    tool_refresh_interval_s: int = 300
    mcp_downstream_connect_timeout_s: float = 30.0
    mcp_downstream_read_timeout_s: float = 180.0

    # ===== gateway-sse：SSE 等待新增量事件超时（秒），超时未等到则发一次心跳保活 =====
    sse_heartbeat_interval_s: float = 5.0

    # ===== 知识库流水线（默认值；运行时 mineru 以 DB knowledge_pipeline 为准） =====
    knowledge_job_concurrency: int = 1
    knowledge_llm_max_concurrent: int = 4
    knowledge_vlm_max_concurrent: int = 2
    knowledge_fixed_chunk_chars: int = 1000
    knowledge_fixed_chunk_overlap_chars: int = 200
    knowledge_wiki_leaf_max_chars: int = 4000
    knowledge_understand_tree_concurrency: int = 4
    knowledge_mineru3_poll_interval_seconds: float = 2.0
    knowledge_mineru3_poll_timeout_seconds: float = 3600.0
    knowledge_mineru3_submit_timeout_seconds: float = 120.0
    knowledge_max_file_bytes: int = 10 * 1024 * 1024

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
