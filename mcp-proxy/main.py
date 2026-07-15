"""
mcp-proxy 入口：按 X-User-Id 加载系统 + 个人 MCP Server。
支持 X-Mcp-Servers 头按 Skill 声明的 Server 子集过滤 tools/list 与 tools/call。

缓存策略：按"真实 MCP Server"缓存，不按"用户 + Skill 白名单组合"缓存
（详见 services/mcp_cache_manager.py）。同一个真实 Server 无论被多少种白名单
组合引用，只连接、只缓存一次；系统级 Server 的缓存在所有用户间共享。

  - 成功 TTL = 300s：命中缓存直接返回，TTL 内不重建
  - 连接失败重试间隔 = 10s：避免瞬时故障被当作"确认无工具"缓存满 5 分钟
  - 强制失效时机（下次请求触发重建）：
      1. add / delete MCP Server 配置变更时（per-server 精确失效）
      2. 手动 probe（/servers/status）后（per-server 精确失效）
      3. 系统配置全量替换时（全量失效）
  - 系统重启：预热系统 MCP + 后台并行预热所有用户 MCP（sandbox/pi-runtime 启动时
    不再单独发请求预热，直接依赖这份全局缓存）
"""
import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from config import settings
from pi_shared import AccessLogMiddleware, setup_logging
from routes.mcp import router as mcp_router
from services import mongo_client
from services.manager import manager

setup_logging("mcp-proxy")
logger = logging.getLogger(__name__)


async def _preload_all_users_background() -> None:
    """后台并行预热所有用户的全量 MCP 工具列表（系统重启时触发）。"""
    try:
        user_ids = await mongo_client.list_user_ids_with_mcp()
        logger.info("启动预热：发现 %d 个有 MCP 配置的用户", len(user_ids))
        await asyncio.gather(
            *(manager.force_refresh(uid) for uid in user_ids),
            return_exceptions=True,
        )
        logger.info("所有用户 MCP 预热完毕")
    except Exception as exc:
        logger.error("启动预热失败: %s", exc)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("mcp-proxy 启动中...")
    await mongo_client.connect()

    # 同步预热系统 MCP（阻塞启动，确保就绪）
    await manager.force_refresh(None)
    logger.info("mcp-proxy 启动完成，监听端口 %d", settings.mcp_proxy_port)

    # 后台预热所有用户 MCP（不阻塞启动）
    asyncio.create_task(_preload_all_users_background())

    yield

    logger.info("mcp-proxy 关闭中...")
    await manager.close_all()
    await mongo_client.disconnect()


app = FastAPI(title="MCP Proxy", version="1.0.0", lifespan=lifespan)
app.add_middleware(AccessLogMiddleware)

app.include_router(mcp_router)


@app.get("/health", tags=["health"])
async def health() -> dict:
    return {"status": "ok"}
