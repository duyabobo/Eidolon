from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    mcp_proxy_port: int = 8080
    mongo_uri: str = "mongodb://mongo:27019"
    mongo_db: str = "pi_agent"

    # 工具列表缓存 TTL（秒）
    # 正常使用直接走缓存；add/delete/test 三个关键点会强制失效指定 Server，下次请求时重建
    tool_refresh_interval_s: int = 300

    # 下游 MCP（arxiv 等外网工具）读写超时；默认 SDK 仅 30s，search_papers 易超时
    mcp_downstream_connect_timeout_s: float = 30.0
    mcp_downstream_read_timeout_s: float = 180.0

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
