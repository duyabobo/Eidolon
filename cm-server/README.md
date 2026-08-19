# CM Server

CM 桌面架构下的单进程 FastAPI 服务，合并了原 `gateway` / `gateway-sse` / `admin` /
`llm-proxy` / `mcp-proxy` 五个独立部署的服务。

## 为什么合并

拆成 5 个服务是多租户服务器版的扩容策略：SSE 按并发连接数扩容、gateway 按 QPS 扩容、
mcp-proxy/llm-proxy 按下游调用量扩容，彼此独立部署互不拖累。桌面单机单用户场景不存在
「扩容」这个维度，5 个进程只带来更多端口占用、更多子进程管理复杂度（Electron 要看护
5 个子进程而不是 1 个），以及跨进程 HTTP 调用的延迟开销。合并后：

- 5 个端口 → 1 个端口（`CM_SERVER_PORT`，默认 `8000`）
- 5 个 SQLite 连接 → 1 个（合并前已经共享同一个文件和同一份表结构，见 `cm_server/shared/db.py`）
- gateway-sse 的进程内 SSE 事件总线（`asyncio.Condition`）与 gateway 的任务派发天然同进程，
  不再需要"发布方和订阅方分进程"这种此前靠 HTTP 中转勉强解决的架构约束

## 目录结构

```
cm_server/
  config.py          # 合并后的统一配置（原 5 份 Settings 的并集，去重同名字段）
  shared/db.py        # 唯一的 SQLite 连接（原 5 份 Database 单例合并为 1 份）
  main.py             # 单一 FastAPI app + 统一 lifespan，挂载全部 router
  gateway/            # 原 gateway：会话 CRUD、任务派发、用户可见 skill/MCP
  gateway_sse/        # 原 gateway-sse：SSE 长连接、pi-runtime 增量事件推送入口
  admin/               # 原 admin：系统配置、知识库、skill-creator、workspace 文件
  llm_proxy/           # 原 llm-proxy：LLM 代理、配置管理、调用记录重放
  mcp_proxy/           # 原 mcp-proxy：MCP JSON-RPC 分发、工具缓存、Server 探测
```

每个子包内部保留原服务的 `routes/services/models` 三层结构，只是 import 路径从扁平的
`from services.xxx import yyy` 改成了包内绝对路径 `from cm_server.<pkg>.services.xxx import yyy`，
**业务逻辑没有改动**。子包自己的 `config.py` / `services/db.py` 是转发到
`cm_server.config` / `cm_server.shared.db` 的薄包装，保留原文件名只是为了让原有内部
`from config import settings` / `from services.db import get_db` 之类的写法只需要改前缀，
不需要改调用方式。

## 已知的过渡态设计（后续可优化项）

合并前 gateway → mcp-proxy、admin → mcp-proxy/llm-proxy 之间是跨容器 HTTP 调用
（`services/mcp_proxy_client.py`、`services/skill_creator_llm.py` 等）。合并成单进程后，
这几个调用点**仍然发 HTTP 请求**，只是 `base_url` 从 `http://mcp-proxy:8080` 之类的容器
地址改成了回环地址 `http://127.0.0.1:{CM_SERVER_PORT}`（见 `cm_server/config.py` 的
`mcp_proxy_base_url` / `llm_proxy_base_url`）。这是本次合并里风险最低的方式——不用碰这些
调用点的请求头 / 用户上下文传递逻辑。如果后续要彻底去掉这层"进程内回环 HTTP"换成直接函数
调用，需要逐个评估每个调用点（当前只有 3 个文件）的上下文传递方式，作为独立的优化任务。

`pi-runtime` 保持独立 Node 进程不变（沙盒执行需要独立于 Python 主进程），`PI_RUNTIME_BASE_URL`
仍指向真正的外部地址。

## 启动生命周期

按依赖顺序在 `main.py` 的 `lifespan` 里依次执行（原来分散在 5 个服务各自的
`startup`/`connect()` 里）：

1. 连接共享 SQLite（唯一一次，原 5 份连接合并为 1 份）
2. 清掉已下放到工具市场的系统 MCP 残留记录（原 admin 的 `retire_builtin_system_servers`）
3. 从数据库加载 LLM 配置到内存（原 llm-proxy 的 `load_from_db`）
4. 同步预热系统级 MCP 工具缓存（原 mcp-proxy 的 `force_refresh(None)`）——**失败不阻塞启动**，
   见下方说明
5. 后台并行预热所有用户的 MCP 工具缓存（不阻塞启动）

### 为什么第 4 步要显式捕获异常

用户自配的远程 MCP 一时不可达时，MCP SDK 的 streamable-http 传输在 anyio TaskGroup 内部失败
时会以 `CancelledError`（而不是普通 `Exception`）冒泡，绕过 `_do_refresh` 内部原有的
`except Exception`，一直冒泡到 `main.py` 让整个进程启动失败。这在桌面单机场景不可接受——
一个工具服务没起来，不该导致整个 CM Server 无法启动，因此在 `main.py` 里改为记录日志、
不阻塞启动；失败的 Server 会在 `needs_refresh()` 的失败重试间隔（10s）之后，由下一次真实
请求触发的 `refresh_if_stale()` 自动重连。

## 配置

见 `cm_server/config.py`，统一 `Settings`，环境变量沿用原字段名（`SQLITE_PATH`、
`SANDBOX_ROOT`、`LLM_BASE_URL` 等），仅去掉了 5 个各自独立的 `*_HOST`/`*_PORT`，
统一为 `CM_SERVER_HOST` / `CM_SERVER_PORT`。

## 本地运行

```bash
cd cm-server
pip install -r requirements.txt
pip install -e ../pi-shared
uvicorn cm_server.main:app --host 0.0.0.0 --port 8000
```

## 依赖

- `pi-shared`：日志、中间件、SQLite 访问层、时间/JSON 编码工具
- `pi-runtime`（独立 Node 进程）：任务执行、沙盒管理，通过 HTTP 调用

## Electron 打包（PyInstaller）

`main.py` 只定义 FastAPI `app`，容器里靠 `uvicorn cm_server.main:app` 命令行启动；PyInstaller
只能打包"运行一个 Python 脚本"，因此新增了 `run.py` 作为打包入口（显式调用
`uvicorn.run(app, host=settings.cm_server_host, port=settings.cm_server_port)`），业务代码不变。

```bash
# 独立虚拟环境跑 PyInstaller，不污染开发环境依赖，产物拷到仓库根目录 build/cm-server/
bash ../scripts/build-cm-server.sh
```

只能在目标架构机器上运行（PyInstaller 不支持交叉编译），mac arm64 安装包必须在 Apple Silicon
Mac 上打包。Electron 主进程通过环境变量传参启动打包后的可执行程序（`electron/src/process-manager.ts`
的 `startCmServer`），字段名与容器环境完全一致：`CM_SERVER_HOST`/`CM_SERVER_PORT`/`SQLITE_PATH`/
`SANDBOX_ROOT`/`LOG_DIR`/`PI_RUNTIME_BASE_URL`，只是取值从容器路径换成了
`app.getPath('userData')` 下的路径，详见 [../electron/README.md](../electron/README.md)。
