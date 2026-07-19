from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    admin_host: str = "0.0.0.0"
    admin_port: int = 9000

    # MongoDB（存储 MCP 配置 + skill 元数据）
    mongo_uri: str = "mongodb://mongo:27019"
    mongo_db: str = "pi_agent"

    # 共享文件系统根目录（global/skills/ 放在此处，与 pi-runtime 共享）
    sandbox_root: str = "/data/sandboxes"

    # skill-creator 对话创建 Skill 时调用 llm-proxy
    llm_proxy_base_url: str = "http://llm-proxy:9001"

    # skill-creator 拉取 MCP Server 工具列表
    mcp_proxy_base_url: str = "http://mcp-proxy:8080"

    # Docker 内访问宿主机 mRAG；本机直跑 admin 时可改为 http://127.0.0.1:9621
    knowledge_local_base_url: str = "http://host.docker.internal:9621"
    knowledge_prod_base_url: str = "http://www.scienceone.cn/mrag-knowledge"
    knowledge_test_base_url: str = "http://1.92.211.130:38026/mrag-knowledge"

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
