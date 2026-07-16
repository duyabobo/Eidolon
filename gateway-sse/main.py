"""
gateway-sse 入口：独立于 gateway（API 服务）部署的 SSE 长连接服务。

从 gateway 拆出的原因：SSE 是长驻连接，扩容依据是"并发连接数"；
gateway 处理的会话 CRUD / 任务派发是短请求，扩容依据是"QPS"。
两者的资源特征和扩容节奏不同，混在同一进程里会导致任一维度打满时
互相拖累，因此拆分为可独立部署、独立扩容的两个运行单元。

gateway-sse 只读 MongoDB（session 存在性 + 历史快照）和 Redis Stream（增量输出），
不做任何写操作；session 创建 / 任务派发 / 状态写入均由 gateway 负责。
"""
import logging

from fastapi import FastAPI

from config import settings
from pi_shared import AccessLogMiddleware, setup_logging
from routes.stream import router as stream_router
from services import mongo_client, redis_client

setup_logging("gateway-sse")
logger = logging.getLogger(__name__)

app = FastAPI(title="onenew Gateway SSE", version="1.0.0")
app.add_middleware(AccessLogMiddleware)
app.include_router(stream_router)


@app.on_event("startup")
async def on_startup() -> None:
    logger.info("gateway-sse 启动中...")
    await mongo_client.connect()
    await redis_client.connect()
    logger.info("gateway-sse 启动完成，监听 %s:%d", settings.gateway_sse_host, settings.gateway_sse_port)


@app.on_event("shutdown")
async def on_shutdown() -> None:
    logger.info("gateway-sse 关闭中...")
    await mongo_client.disconnect()
    await redis_client.disconnect()


@app.get("/health", tags=["health"])
async def health() -> dict:
    return {"status": "ok"}
