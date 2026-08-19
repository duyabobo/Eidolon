"""CM 单进程入口：合并原 gateway / gateway-sse / admin / llm-proxy / mcp-proxy 五个 FastAPI 服务。

合并动机（对应 CM 桌面架构）：桌面单机单用户场景不再需要按「QPS / 并发连接数 / 独立扩容」
拆分成 5 个可独立部署的服务，反而是越少进程、越少端口，对 Electron 的子进程管理和本地
资源占用越友好；SSE 的进程内事件总线（`gateway_sse.services.event_store`）与任务派发
（`gateway.services.task_dispatch`）本来就要求发布方和订阅方同进程才能生效，合并后不再
需要跨进程的 HTTP 中转。

模块边界通过 Python 包名保留：每个原服务的 routes/services/models 分别位于
`cm_server.<service>.*` 下，互不覆盖；启动生命周期（db 连接、清掉已下放工具市场的系统 MCP、
llm-proxy 内存配置预热、mcp-proxy 工具缓存预热）在本文件的 lifespan 里按原有顺序依次执行。
"""
import asyncio
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from pi_shared import AccessLogMiddleware, install_json_encoders, setup_logging

from cm_server.config import settings
from cm_server.shared import db as shared_db

from cm_server.gateway.routes import internal as gateway_internal
from cm_server.gateway.routes import mcp as gateway_mcp
from cm_server.gateway.routes import session as gateway_session
from cm_server.gateway.routes import session_upload as gateway_session_upload
from cm_server.gateway.routes import skills as gateway_skills

from cm_server.gateway_sse.routes import internal as gateway_sse_internal
from cm_server.gateway_sse.routes import stream as gateway_sse_stream

from cm_server.admin.routes import config as admin_config
from cm_server.admin.routes import knowledge as admin_knowledge
from cm_server.admin.routes import skill_creator as admin_skill_creator
from cm_server.admin.routes import skills as admin_skills
from cm_server.admin.routes import wiki as admin_wiki
from cm_server.admin.routes import workspace as admin_workspace
from cm_server.admin.services.mcp_server_store import retire_builtin_system_servers

from cm_server.llm_proxy.routes import llm_config as llm_proxy_config
from cm_server.llm_proxy.routes import proxy as llm_proxy_proxy
from cm_server.llm_proxy.routes import replay as llm_proxy_replay
from cm_server.llm_proxy.services.llm_config_store import load_from_db as load_llm_config_from_db

from cm_server.mcp_proxy.routes import mcp as mcp_proxy_mcp
from cm_server.mcp_proxy.services.manager import manager as mcp_manager
from cm_server.shared.machine_uid import current_user_id

setup_logging("cm-server")
install_json_encoders()
logger = logging.getLogger(__name__)


async def _preload_local_mcp_background() -> None:
    """后台预热本机 MCP 工具列表缓存，不阻塞启动。"""
    try:
        uid = await current_user_id()
        await mcp_manager.force_refresh(uid)
        logger.info("本机 MCP 预热完毕 user=%s", uid)
    except Exception:
        logger.exception("本机 MCP 预热失败")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("cm-server 启动中...")
    await shared_db.connect()

    # arxiv/nature 已下放到工具市场，清掉旧库里残留的系统级记录，避免连死地址
    await retire_builtin_system_servers()

    # 原 llm-proxy 启动步骤：把激活的 LLM profile 载入内存，之后 proxy 直接读内存
    await load_llm_config_from_db()

    # 原 mcp-proxy 启动步骤：同步预热系统级 MCP（阻塞，确保就绪）+ 后台预热用户 MCP。
    # 预热失败只记录日志，不阻塞启动：用户自配的远程 MCP 一时不可达，不该拖垮整个进程。
    # 失败的 Server 会在 `needs_refresh()` 的失败重试间隔后，由后续请求触发的
    # `refresh_if_stale()` 自动重试。
    # MCP SDK 的 streamable-http 传输在 anyio TaskGroup 内失败时，可能以
    # CancelledError 冒泡，绕过 `_do_refresh` 内部的 `except Exception`。
    try:
        await mcp_manager.force_refresh(None)
    except (Exception, asyncio.CancelledError):
        # 这里特意把 asyncio.CancelledError（Python 3.8+ 继承自 BaseException，
        # 普通 except Exception 捕不到）也一并按"预热失败"处理：验证过实际触发
        # 场景是 MCP SDK 的 streamable-http 传输在 anyio TaskGroup 内部失败时，
        # 会把真实错误包进 CancelledError 冒泡出来，不是本协程真的被取消，
        # 不代表进程正在关闭，因此在这个启动阶段吞掉它是安全的。
        logger.exception("系统级 MCP 预热失败，将在后续请求时按失败重试间隔自动重连")
    asyncio.create_task(_preload_local_mcp_background())

    logger.info("cm-server 启动完成，监听 %s:%d", settings.cm_server_host, settings.cm_server_port)
    yield

    logger.info("cm-server 关闭中...")
    await mcp_manager.close_all()
    await shared_db.disconnect()


app = FastAPI(title="Eidolon CM Server", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(AccessLogMiddleware)

# gateway：会话 CRUD / 任务派发 / 用户可见 skill 与 MCP
app.include_router(gateway_session.router)
app.include_router(gateway_session_upload.router)
app.include_router(gateway_skills.router)
app.include_router(gateway_mcp.router)
app.include_router(gateway_internal.router)

# gateway-sse：SSE 长连接 + pi-runtime 增量事件推送入口
app.include_router(gateway_sse_stream.router)
app.include_router(gateway_sse_internal.router)

# admin：系统级配置、知识库、skill-creator、workspace 文件管理
app.include_router(admin_config.router)
app.include_router(admin_knowledge.router)
app.include_router(admin_wiki.router)
app.include_router(admin_skill_creator.router)
app.include_router(admin_skills.router)
app.include_router(admin_workspace.router)

# llm-proxy：上游 LLM 代理 + 配置管理 + 调用记录重放
app.include_router(llm_proxy_proxy.router)
app.include_router(llm_proxy_config.router)
app.include_router(llm_proxy_replay.router)

# mcp-proxy：MCP JSON-RPC 分发 + 缓存管理 + Server 探测
app.include_router(mcp_proxy_mcp.router)


@app.get("/health", tags=["health"])
async def health() -> dict:
    return {"status": "ok"}
