# Gateway 服务

## 职责边界

Gateway 负责平台对外的会话 CRUD 与任务派发（短请求、按 QPS 扩容）：

- 接收用户请求，创建/查询 Session
- 向 pi-runtime 派发任务（通过 Redis Streams）
- Skill 列表、MCP Server 配置查询/CRUD

**不负责**：
- SSE 流式输出：长驻连接的扩容依据（并发连接数）与本服务（QPS）不同，
  拆分为独立服务 [gateway-sse](../gateway-sse/README.md) 部署，避免两者互相拖累扩容节奏
- 由 pi-runtime 执行引擎负责（对外品牌 onenew）
- 调用 LLM（由 pi-runtime 通过 admin 负责）
- 配置管理（由 admin 负责）
- 文件系统操作（由 pi-runtime 内部处理）
- bwrap 沙盒管理

---

## API

### `POST /sessions` — 创建或复用会话

**请求体：**
```json
{
  "user_id": "alice",
  "request": "帮我写一个冒泡排序"
}
```

**响应：**
```json
{
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "PENDING"
}
```

**幂等性**：相同 `user_id + request` 且任务未结束时，返回已有 session_id，不重复创建。

同一用户可同时发起多个不同 `request` 的会话（session 级文件系统隔离，互不影响）。

---

### `GET /sessions/{session_id}` — 查询会话详情

返回 session 的完整文档，包含 status / request / events_snapshot 等字段。

**状态流转：**
```
PENDING → RUNNING → COMPLETED
                  → FAILED
```

---

### SSE 流式拉取 — 已迁移至 gateway-sse

`GET /sessions/{session_id}/stream` 与 `GET /sessions/{session_id}/turns/{turn_id}/stream`
两个 SSE 接口现由独立服务 [gateway-sse](../gateway-sse/README.md) 提供（默认端口 `8001`），
接口路径、参数、事件类型均未变化，详见该服务的 README。

---

## 内部实现

```
客户端
  │
  │ POST /sessions
  ▼
gateway/routes/session.py
  ├── 查询 MongoDB: find_active_session_by_request（幂等）
  ├── 创建 MongoDB session 文档（status: PENDING）
  └── XADD agent:tasks → Redis Stream
                               │
                               └── pi-runtime 消费（XREADGROUP）

  │ GET /sessions/{id}/stream（gateway-sse，见 ../gateway-sse/README.md）
```

---

## Skill API

元数据统一存 MongoDB `skills` 集合（`user_id` 为空=系统，有值=用户）；正文按需读 NFS。

| 接口 | 说明 |
|------|------|
| `GET /skills?user_id=` | 列表（MongoDB） |
| `GET /skills/{name}/content?user_id=` | 读正文（NFS，按需） |

用户/系统 Skill 的创建均通过 admin `POST /config/skills/creator/...`（传 `user_id` 创建用户 Skill），发布时 Mongo + NFS 同步。

系统 Skill CRUD（除创建外）由 admin `/config/skills` 管理。

---

## 依赖关系

| 依赖 | 用途 | 连接方式 |
|------|------|---------|
| MongoDB | session 文档、Skill 元数据 | motor（async）|
| Redis | 发布任务 / 读写控制信号 | redis[asyncio] |
| 共享文件系统 | Skill 正文读写 | 挂载 `SANDBOX_ROOT` |

**不依赖**：admin、pi-runtime、gateway-sse（单向依赖，gateway 不调用这三个服务）

---

## 配置

| 环境变量 | 说明 | 默认值 |
|---------|------|-------|
| `MONGO_URI` | MongoDB 连接串 | `mongodb://mongo:27017` |
| `MONGO_DB` | 数据库名 | `pi_agent` |
| `REDIS_URL` | Redis 连接串 | `redis://redis:6379` |
| `GATEWAY_HOST` | 监听地址 | `0.0.0.0` |
| `GATEWAY_PORT` | 监听端口 | `8002` |
| `SANDBOX_ROOT` | 共享文件系统（Skill 正文） | `/data/sandboxes` |

SSE 相关配置（`GATEWAY_SSE_PORT`、`SSE_BLOCK_MS` 等）见
[gateway-sse/README.md](../gateway-sse/README.md#配置)。
