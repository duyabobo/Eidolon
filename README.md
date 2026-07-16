# onenew

多租户 Agent 执行平台（对外品牌 **onenew**），支持会话管理、SSE 流式输出、bwrap 沙盒隔离、MCP 工具扩展、Skill 渐进式披露、本地知识库管理。

---

## 整体架构

### 图 1 系统总体架构

![系统总体架构](docs/assets/system-architecture.png)

系统分为知识构建与检索层、Agent 服务层、运行交互层。知识构建与检索层将多模态文档转化为可检索知识节点；Agent 服务层通过 MCP 调用检索工具并按 Skill 控制工具范围；运行交互层负责会话、沙盒执行和流式结果呈现。

### 图 2 Agentic RAG 协作时序

![Agentic RAG 协作时序](docs/assets/agentic-rag-sequence.png)

用户发送问题后，Gateway 创建会话并将任务写入 Redis Streams；pi-runtime 作为 Consumer Group 消费者认领任务，在沙盒中运行 Agent，并在任务完成后确认消费。Agent 通过 MRAG 系统的 MCP 调用组合检索或图谱检索；Token、工具调用和工具结果写入 Redis Stream，Gateway-SSE 订阅事件并以 SSE 推送至前端，支持断线续传与历史回放。

---

| 服务 | 端口 | 技术栈 | 职责 |
|------|------|--------|------|
| **frontend** | 3000 | React + Vite + Tailwind | 对话界面、LLM / MCP / Skill 配置管理页 |
| **gateway** | 8002 | Python FastAPI | 会话 CRUD、任务派发、Skill 元数据列表（按 QPS 扩容） |
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
# API         → http://localhost:8002/docs
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
