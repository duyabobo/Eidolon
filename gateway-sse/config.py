from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    gateway_sse_host: str = "0.0.0.0"
    gateway_sse_port: int = 8001

    mongo_uri: str = "mongodb://mongo:27017"
    mongo_db: str = "pi_agent"

    redis_url: str = "redis://redis:6379"
    # 每个 SSE 长连接在阻塞 XREAD 期间会独占一条连接池连接；
    # 池大小需按单实例可承载的最大并发 SSE 连接数配置，而非按 API QPS 估算。
    redis_max_connections: int = 200

    # SSE 拉取 Redis Stream 时的阻塞超时（毫秒），超时未读到数据则发一次心跳保活
    sse_block_ms: int = 5000

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
