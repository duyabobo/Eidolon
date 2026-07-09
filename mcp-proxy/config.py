from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    mcp_proxy_port: int = 8080
    mongo_uri: str = "mongodb://mongo:27017"
    mongo_db: str = "pi_agent"

    # 工具列表缓存 TTL（秒）
    # 正常使用直接走缓存；add/delete/test 三个关键点会强制失效指定 Server，下次请求时重建
    tool_refresh_interval_s: int = 300

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
