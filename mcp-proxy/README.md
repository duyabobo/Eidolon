# mcp-proxy 服务（MCP 聚合代理）

## 职责边界

mcp-proxy 是 MCP 工具调用的统一出口，负责：

- 从 MongoDB 读取所有已启用的 MCP Server 配置
- 连接各后端 MCP Server，汇总工具列表
- 对外暴露单一 MCP HTTP 端点，供沙盒内 pi 调用
- 将 pi 的工具调用请求路由到对应的后端 MCP Server 并返回结果

**不负责**：
- 用户认证（由 gateway 负责）
- MCP 配置的写入（由 admin 负责）
- 直接执行任何工具逻辑（纯代理转发）

---

## 在整体架构中的位置

```
pi（bwrap 沙盒内，完全无网）
  ↓ HTTP 127.0.0.1:8080（loopback）
  ↓ Unix socket /tmp/pi-socks/sessions/{sessionId}/mcp.sock（仅本 session 挂载）
  ↓ TCP
mcp-proxy（沙盒外，有网）
  ↓ MCP HTTP 协议
真实 MCP Server 1、2、N...
```

pi 通过 mcp-proxy 间接调用外部工具，沙盒内没有任何 MCP Server 的连接信息，也无法绕过代理直接访问。

---

## 核心组件

```
mcp-proxy/
├── main.py                     FastAPI 入口，实现 MCP JSON-RPC 协议
├── config.py                   环境变量配置（pydantic-settings）
├── logger.py                   日志初始化（与 gateway 风格一致）
├── requirements.txt
├── Dockerfile
└── services/
    ├── mongo_client.py         只读 MongoDB：读取启用的 MCP Server 列表
    ├── mcp_server_cache.py     单个真实 Server 的连接、工具表、刷新状态
    ├── mcp_cache_manager.py    按 (owner, server_name) 缓存管理 + 请求侧工具视图合并
    ├── mcp_connection.py       下游连接；按请求透传 X-User-Id
    └── request_user.py         入站用户 ContextVar（供 httpx hook 读取）
```

**技术栈**：FastAPI + motor（异步 MongoDB）+ `mcp` Python SDK（官方 MCP 客户端）

---

## 租户身份约定（所有下游 MCP 必须遵守）

沙盒内 Agent **不可信**。会话用户身份由 pi-runtime 的 session-mcp-bridge 强制写入入站
`X-User-Id`，mcp-proxy 在发往**每一个**下游 MCP Server 的 HTTP 请求上透传同名头
（`contextvars` + httpx request hook）。系统级 Server 仍按 `(__system__, name)` 共享连接；
身份按请求注入，不会因共享连接而串用户。

| 规则 | 说明 |
|------|------|
| 租户身份来源 | 只信请求头 `X-User-Id` |
| 工具参数 | 不得用 Agent 可控参数（如 `scene_uid`）做鉴权或租户隔离 |
| 无 `X-User-Id` | 表示匿名 / 探测 / 预热；Server 自行决定是否拒绝 |
| 传输偏好 | 身份透传在 **streamable-http** 上最可靠；SSE 长连接若只认握手头，应改读后续 POST 头或改用 streamable-http |
| SSE 跨 task | MCP SDK 的 `post_writer` 在独立 task，ContextVar 不可见；mcp-proxy 用连接级 `OutboundUserIdSlot` + `call_tool` 串行写入，hook 注入 HTTP 头 |

mrag 等业务 MCP 需自行改为读取 `X-User-Id`（本仓库只负责透传与约定）。Agent 若在工具参数 `headers.x-user-id` 里伪造身份，mcp-proxy 会覆盖为入站可信值。

---

## 工具缓存与刷新机制

缓存粒度是**真实 MCP Server**，不是"用户 + Skill 白名单组合"：

```
缓存键 = (owner, server_name)
  owner = "__system__"     系统级 Server，所有用户共享同一份连接
  owner = user_id          用户级 Server，仅该用户可见

一次 tools/list 请求：
  1. 按 (user_id, 白名单) 从 MongoDB 读出应加载的 Server 列表
  2. 逐个按 (owner, server_name) 查找/创建缓存，命中则直接用，否则重建
  3. 合并这些已缓存 Server 的工具，返回给调用方
```

同一个真实 Server 无论被多少种 skill 白名单组合引用（例如 skill A 只用 `mrag`，
skill B 用 `mrag,tavily`），都只连接、只缓存一次；不会因为白名单组合不同而重复
建连接、重复占用一份工具列表缓存。系统重启时的预热（见下）已经覆盖了系统级和
各用户的全部 Server，pi-runtime 在沙盒启动时不需要也不应该再单独发请求预热，
直接依赖这份全局缓存即可。

刷新触发条件（满足任一即触发，懒刷新——请求到来时才检查）：

| 触发条件 | 间隔 |
|---------|------|
| 距上次成功刷新超过 TTL | `TOOL_REFRESH_INTERVAL_S`（默认 300s） |
| 被显式标记失效（add/delete/test/probe 后） | 下次请求立即触发 |
| 上次连接失败 | `10s`（远小于成功 TTL，避免瞬时故障被当成"确认无工具"缓存 5 分钟） |

**工具名冲突处理**：同名工具以先发现的 Server 为准，并打印 WARN 日志。

---

## MCP 协议实现

遵循 MCP 2025-03-26 Streamable HTTP 规范：

| 方法 | 处理方式 |
|------|---------|
| `initialize` | 返回服务能力声明（`{ tools: {} }`） |
| `tools/list` | 返回聚合后的全量工具列表 |
| `tools/call` | 路由到对应后端执行，返回结果 |
| `notifications/*` | 确认（202，无响应体） |

所有响应均为 `application/json`，不使用 SSE 流式传输（工具调用本身是同步的）。

---

## 依赖关系

| 依赖 | 用途 | 方向 |
|------|------|------|
| MongoDB | 读取 MCP Server 配置 | 只读 |
| 各 MCP Server | 工具发现 + 工具调用 | HTTP 调用 |

**不依赖**：Redis、gateway、pi-runtime、llm-proxy

---

## 平台内置 MCP

平台通过独立 sidecar 提供官方 MCP，**不**在 mcp-proxy 进程内跑 stdio：

| Server 名 | 服务 | URL | 说明 |
|-----------|------|-----|------|
| `arxiv` | `arxiv-mcp` | `http://arxiv-mcp:8081/mcp` | blazickjp/arxiv-mcp-server（Streamable HTTP + pdf extra） |

- admin 启动时幂等写入 Mongo `mcp_servers`（`user_id=null`；已存在则不覆盖）
- 论文缓存卷：`arxiv_papers` → `/data/arxiv-papers`
- 日志与其它服务一致：`pi_shared.setup_logging("arxiv-mcp")` → `./logs/arxiv-mcp/arxiv-mcp.log`（按天切割，保留 7 天）
- `ALLOWED_HOSTS` 必须包含服务名**带端口**形式（如 `arxiv-mcp:8081`），否则 Streamable HTTP 的 DNS rebinding 保护会拒绝 mcp-proxy 的请求
- Skill `mcp_tools` 可按工具名白名单，常用：`search_papers`、`get_abstract`、`download_paper`、`list_papers`、`read_paper`、`get_paper_latex`、`list_paper_latex_sections`、`get_paper_latex_section`、`citation_graph`、`export_citations`、`watch_topic`、`check_alerts`（未装 `[pro]`，无 `semantic_search`/`reindex`）

---

## 配置

| 环境变量 | 说明 | 默认值 |
|---------|------|-------|
| `MCP_PROXY_PORT` | 服务监听端口 | `8080` |
| `MONGO_URI` | MongoDB 连接串 | `mongodb://mongo:27019` |
| `MONGO_DB` | 数据库名 | `pi_agent` |
| `TOOL_REFRESH_INTERVAL_S` | 工具列表成功缓存 TTL（秒）| `300` |
| `MCP_DOWNSTREAM_CONNECT_TIMEOUT_S` | 下游 MCP 连接超时（秒） | `30` |
| `MCP_DOWNSTREAM_READ_TIMEOUT_S` | 下游 MCP 读超时（秒，arxiv 搜索需较大） | `180` |
