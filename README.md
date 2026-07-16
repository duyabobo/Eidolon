# onenew

基于 [Pi Coding Agent](https://pi.dev/) 构建的多租户 Agent 执行平台（对外品牌 **onenew**），支持会话管理、SSE 流式输出、bwrap 沙盒隔离、MCP 工具扩展、Skill 渐进式披露、本地知识库管理。

---

## 整体架构

### 分层架构

```text
    ┏━━━━━━━━━━━━━━━━━━━━━━━━┓              ┏━━━━━━━━━━━━━━━━━━━━━━━━┓
    ┃  用户层  frontend :3000 ┃              ┃  扩展层                 ┃
    ┗━━━━━━━━━━━━┬━━━━━━━━━━━┛              ┃  llm-proxy :9001       ┃
                 │ HTTP / SSE               ┃  mcp-proxy :8080       ┃
                 ▼                          ┗━━━━━━━━━━━━▲━━━━━━━━━━━┛
    ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓                 │ Unix socket
    ┃  接口层                           ┃    ┏━━━━━━━━━━━━┷━━━━━━━━━━━┓
    ┃  gateway     :8000  CRUD/派发·QPS 扩容┃  ┃  执行层                 ┃
    ┃  gateway-sse :8001  SSE·连接数扩容    ┃  ┃  onenew 执行引擎：bwrap 沙盒   ┃
    ┃  admin       :9000  配置管理          ┃  ┗━━━━━━━━━━━━┬━━━━━━━━━━━┛
    ┗━━━━━━━━━━━━┬━━━━━━━━━━━━━━━━━━━━━━━┛                 │ read/write
                 │ read/write                              │
                 │                                         │
                 └─────────────────┬───────────────────────┘
                                   ▼
    ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
    ┃  持久化      Redis :6379  ·  MongoDB :27017  ·  NFS             ┃
    ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
```

`gateway` 与 `gateway-sse` 从同一个服务拆分而来：前者是短请求（会话 CRUD、任务派发），
按 QPS 扩容；后者是 SSE 长连接，按并发连接数扩容。二者资源特征和扩容节奏不同，绑在
一个进程里会互相拖累，故拆分为两个独立部署、独立扩容的运行单元，详见
[gateway/README.md](gateway/README.md) 与 [gateway-sse/README.md](gateway-sse/README.md)。

### 协作时序（发送消息 · 流式回复）

```text
  用户层           接口层（gateway）      持久化层            执行层             扩展层
(frontend)      CRUD/派发   SSE 长连接  (Redis/Mongo/NFS)     (bwrap·pi)       (llm/mcp-proxy)
                (gateway) (gateway-sse)
    │                 │           │           │                 │                 │
    │1.POST /sessions►│           │           │                 │                 │
    │                 │           │           │                 │                 │
    │                 │2.Write session────────►│MongoDB          │                 │
    │                 │           │           │                 │                 │
    │                 │─3.XADD task───────────►│Redis Stream     │                 │
    │                 │           │           │                 │                 │
    │                 │           │           │─4.XREADGROUP───►│                 │
    │◄─────session────│           │           │                 │                 │
    │                 │           │           │                 │5.start bwrap    │
    │                 │           │ MongoDB/NFS│◄──────Read──────│                 │
    │                 │           │           │                 │                 │
    │─6.SSE /stream(:8001)───────►│           │                 │                 │
    │                 │           │           │                 │                 │
    │                 │           │─7.Read Stream───────────────►│Redis            │
    │                 │           │           │                 │                 │
    │                 │           │      Redis│◄─8.XADD output──│                 │
    │◄──────token─────│           │           │                 │                 │
    │                 │           │           │                 │─9.Unix socket──►│► 外部 LLM/MCP
    ▼                 ▼           ▼           ▼                 ▼                 ▼
```

任务派发使用 Redis Streams Consumer Group：`gateway` 以 `XADD` 写入带 `task_id` 的任务，
pi-runtime 通过 `XREADGROUP` 认领并在任务完成后 `XACK`。超时未确认任务由
`XAUTOCLAIM` 认领恢复；任务状态和执行租约共同抑制重复执行。取消和关闭等实时控制信号
继续使用 Pub/Sub，不承担可靠任务投递职责。步骤 6/7 的 SSE 订阅与流读取完全由
`gateway-sse` 独立处理，与 `gateway` 的写路径（步骤 1-3）没有进程内耦合。

---

| 服务 | 端口 | 技术栈 | 职责 |
|------|------|--------|------|
| **frontend** | 3000 | React + Vite + Tailwind | 对话界面、LLM / MCP / Skill 配置管理页 |
| **gateway** | 8000 | Python FastAPI | 会话 CRUD、任务派发、Skill 元数据列表（按 QPS 扩容） |
| **gateway-sse** | 8001 | Python FastAPI | SSE 流式输出（按并发连接数独立扩容） |
| **admin** | 9000 | Python FastAPI | MCP Server 配置、Skill 管理（元数据 + 文件）|
| **llm-proxy** | 9001 | Python FastAPI | LLM 代理（OpenAI 兼容）、Provider 配置热更新 |
| **mcp-proxy** | 8080 | Python FastAPI | MCP 聚合代理：汇总所有 MCP Server 工具，统一路由调用 |
| **pi-runtime** | — | Node.js 执行引擎 | Agent 任务执行、bwrap 沙盒隔离、Unix socket 网络白名单 |
| **redis** | 6379 | Redis 7 | 任务 Stream Consumer Group、增量输出 Stream、实时控制通知 |
| **mongo** | 27017 | MongoDB 7 | 会话数据、LLM / MCP 配置、Skill 元数据 |

---

## 快速开始

```bash
# 一键部署（首次运行自动创建 .env）
bash deploy.sh

# 访问
# 前端        → http://localhost:3000
# API         → http://localhost:8000/docs
# Gateway-SSE → http://localhost:8001/docs
# Admin       → http://localhost:9000/docs
# LLM Proxy   → http://localhost:9001/docs

# 启动后在前端管理页面配置 LLM Provider（base_url / api_key / model）
```

## 集群部署

```bash
# 生产集群：3 个 pi-runtime 实例，NFS 共享存储
NFS_SERVER_ADDR=192.168.1.100 NFS_EXPORT_PATH=/data/pi-sandboxes \
  bash deploy.sh --prod --scale 3
```

`gateway`（按 QPS 扩容）与 `gateway-sse`（按并发 SSE 连接数扩容）在
`docker-compose.prod.yml` 中已声明独立的 `deploy.replicas`，可分别调整数值。
注意：当前单节点 nginx 直连服务名，`replicas > 1` 前需先接入支持多后端的反向代理
（nginx upstream 动态解析 / Traefik / k8s Service），详见该文件中的说明注释。

---

## 目录结构

```
onenew-platform/
├── README.md              # 本文件
├── deploy.sh              # 一键部署脚本
├── docker-compose.yml     # 单节点编排
├── docker-compose.prod.yml # 集群覆盖配置（NFS 卷）
├── .env.example
├── frontend/              # React + Vite 前端 
├── gateway/               # FastAPI 会话网关 - 会话 CRUD/任务派发（按 QPS 扩容）
├── gateway-sse/           # FastAPI SSE 服务 - 流式输出（按连接数独立扩容）
├── admin/                 # FastAPI 管理服务 - MCP/Skill 配置 
├── llm-proxy/             # FastAPI LLM 代理服务 
├── mcp-proxy/             # FastAPI MCP 聚合代理 
└── pi-runtime/            # Node.js 执行引擎（沙盒内 agent 运行时） 
```

---

## 文档

| 文档 | 说明 |
|------|------|
| [docs/agent-system-architecture.md](docs/agent-system-architecture.md) | 系统架构设计 |
| [docs/pi-internal-flow.md](docs/pi-internal-flow.md) | Pi 内部执行流程 |
| [docs/sandbox-cgroup-delegation.md](docs/sandbox-cgroup-delegation.md) | 沙盒 session cgroup 宿主机委托配置 |
