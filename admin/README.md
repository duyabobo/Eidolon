# Admin 服务（配置管理）

## 职责边界

Admin 是平台的**配置管理中枢**，专注于两类职责：

**1. MCP 配置管理**
- 通过 `/config/mcp` 接口管理 MCP Server 配置（持久化到 MongoDB）
- MCP 配置由 **pi-runtime 在每个 session 启动时直接从 MongoDB 读取**，新 session 即生效

**2. Skill 管理**
- 通过 `/config/skills` 接口管理 global Skill（元数据写 MongoDB，正文写文件系统）
- Skill 正文（SKILL.md）存储在共享文件系统，pi 直接读取，原生渐进式披露

**不负责**：
- LLM 代理 / LLM 配置（由独立的 **llm-proxy** 服务负责）
- session / user 管理（由 gateway 负责）
- bwrap 沙盒（由 pi-runtime 负责）
- 由 pi-runtime 负责执行（不直接暴露底层 agent 品牌）

---

## API

### `GET /config/mcp` — 读取 MCP 配置

返回所有已配置的 MCP Server 列表。

### `PUT /config/mcp` — 全量替换 MCP 配置

### `POST /config/mcp/servers/{name}` — 添加或更新单个 MCP Server

只允许 **HTTP/SSE URL** 类型；禁止 `command`/`args`（stdio 本地进程）。

```json
{
  "url": "http://arxiv-mcp:8081/mcp",
  "description": "平台内置 arXiv",
  "enabled": true,
  "api_key": ""
}
```

平台内置系统级 Server（admin 启动幂等登记，已存在不覆盖）：

| name | url |
|------|-----|
| `arxiv` | `http://arxiv-mcp:8081/mcp` |

### `DELETE /config/mcp/servers/{name}` — 删除 MCP Server

MCP 配置变更后会通知 mcp-proxy 失效缓存；**下一个新建 session** 即使用最新工具列表。

---

### `GET /config/skills` — 列出系统 Skill 元数据（MongoDB，`user_id` 为空）

### `GET /config/skills/{name}/content` — 读取系统 Skill 正文（NFS）

### `POST /config/skills/{name}` — 创建或更新系统 Skill（MongoDB + NFS 同步）

```json
{
  "description": "Python 专家",
  "content": "---\nname: python-expert\n---\n正文内容...",
  "tags": ["python", "coding"],
  "hidden": false
}
```

### `DELETE /config/skills/{name}` — 删除 Skill

---

### Skill Creator（对话创建，内嵌 skill-creator）

基于 [Cursor skill-creator](https://github.com/anthropics/skills/tree/main/skills/skill-creator)（资源位于 `admin/skill_creator/`），通过 LLM 多轮对话生成 Skill 草稿并发布。

| 接口 | 说明 |
|------|------|
| `POST /config/skills/creator/sessions?user_id=` | 创建对话（无 user_id=系统 Skill，有=用户 Skill） |
| `GET /config/skills/creator/sessions/{id}` | 获取会话历史与当前草稿 |
| `POST /config/skills/creator/sessions/{id}/messages` | 发送用户消息，返回助手回复与可选草稿 |
| `POST /config/skills/creator/sessions/{id}/publish` | 发布 Skill（MongoDB 元数据 + NFS 正文同步） |

**前置条件**：llm-proxy 已配置可用 LLM Provider（Admin 前端「LLM 配置」页）。

---

### `GET /health` — 健康检查

```json
{"status": "ok"}
```

---

## 内部实现

```
MCP 配置读取（pi-runtime 侧）：
  pi-runtime/src/mongo-client.ts: getMcpConfig()
    → 直接读 MongoDB configs.mcp（每 session 启动时调用一次）
    → 写入 /tmp/pi-config/{session_id}/mcp.json
    → 通过 PI_CODING_AGENT_DIR 让 pi 使用该目录
```

---

## 依赖关系

| 依赖 | 用途 |
|------|------|
| MongoDB | 持久化 MCP 配置、Skill 元数据、skill-creator 会话 |
| 共享文件系统 | 读写 SKILL.md 文件 |
| llm-proxy | skill-creator 对话创建 Skill 时调用 LLM |

**不依赖**：Redis、gateway、pi-runtime

---

## 配置

| 环境变量 | 说明 | 默认值 |
|---------|------|-------|
| `MONGO_URI` | MongoDB 连接串 | `mongodb://mongo:27019` |
| `MONGO_DB` | 数据库名 | `pi_agent` |
| `SANDBOX_ROOT` | 共享文件系统根目录 | `/data/sandboxes` |
| `LLM_PROXY_BASE_URL` | skill-creator 调用的 llm-proxy 地址 | `http://llm-proxy:9001` |
| `ADMIN_HOST` | 监听地址 | `0.0.0.0` |
| `ADMIN_PORT` | 监听端口 | `9000` |
