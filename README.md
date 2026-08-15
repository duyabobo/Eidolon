# Eidolon

装在你电脑上的个人分身：能对话、能查资料、能用工具，并把你的经验和知识攒下来，越用越像你。

---

## 信念

无论面向哪个垂直领域，Agent 都有一套共性能力：**Agent Loop、Memory、History、RAG 知识库、上下文治理、Tool Use、沙盒权限、Skill 披露、会话工作区**等。这些不应由每个开发者各自再造一套，而应收敛为**稳定、可迭代的底层基座**。

真正的产品价值不在于重复堆叠引擎，而在于：

1. **专业工具**：提供垂直领域的外部工具 / MCP，接入真实世界能力  
2. **经验与知识积累**：辅助用户沉淀、复用与分享 Skill / 经验（含私有知识），形成可复用的领域资产  

**基座负责「会思考、能记住、能检索」且可升级；产品价值在「专业工具」与「帮用户攒经验、攒知识」。** 这才是我们认同的 Agent 开发范式，也是本项目的产品与工程取舍准则。

---

## 整体架构

Eidolon 装在你自己的电脑上：一边是窗口，一边是本机服务。

![系统总体架构](docs/assets/system-architecture.svg)

你在窗口里聊天、管理经验、工具和知识；本机服务负责思考、记住对话、查阅资料，并安全地使用工具。  

---

## 快速开始

```bash
# 本机启动（首次自动创建 .env）
# 前端 http://localhost:3000 ，CM Server http://localhost:8000/docs
bash deploy.sh

# 打 mac arm64 安装包（.dmg）
bash deploy.sh --package
```

---

## 目录结构

```
eidolon-platform/
├── README.md              # 本文件
├── deploy.sh              # Docker 本机调试 / --package 打 mac arm64 .dmg
├── docker-compose.yml     # 单节点编排
├── .env.example
├── frontend/              # React + Vite 前端
├── cm-server/             # FastAPI 单进程服务：合并原 gateway/gateway-sse/admin/llm-proxy/mcp-proxy
├── pi-shared/             # Python 服务共享工具库（日志、中间件、SQLite 访问层）
├── arxiv-mcp/             # 平台内置 arXiv MCP（HTTP sidecar）
├── nature-mcp/            # 平台内置 Nature/Science 学术检索 MCP（HTTP/stdio）
├── pi-runtime/            # Node.js 执行引擎（沙盒内 agent 运行时）
├── electron/              # Electron 主进程：拉起 cm-server/pi-runtime 子进程 + 本机静态代理
└── scripts/               # 打包构建脚本（build-frontend/build-pi-runtime/build-cm-server/package-mac）
```
