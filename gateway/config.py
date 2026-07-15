from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    gateway_host: str = "0.0.0.0"
    gateway_port: int = 8000

    mongo_uri: str = "mongodb://mongo:27017"
    mongo_db: str = "pi_agent"

    redis_url: str = "redis://redis:6379"
    task_stream: str = "agent:tasks"
    task_dedupe_ttl_seconds: int = 86400

    mcp_proxy_base_url: str = "http://mcp-proxy:8080"

    # 共享文件系统根目录（只读挂载，用于读取 Skill 文件内容）
    sandbox_root: str = "/data/sandboxes"

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
