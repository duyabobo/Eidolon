# Gateway-SSE 服务

## 为什么单独拆出这个服务

SSE 是长驻连接，扩容依据是"并发连接数"；`gateway` 处理的会话 CRUD、任务派发是短请求，
扩容依据是"QPS"。两者资源特征不同（长驻 event loop 占用 vs. 高周转短请求），若绑在
同一进程里，任一维度打满都会拖累另一维度：SSE 连接数暴涨会拖慢建会话/发消息；
API 峰值扩容也会白白复制一堆闲置长连接。因此拆分为两个可独立部署、独立扩容的运行单元。

## 职责边界

- 接收前端的 SSE 订阅请求
- 校验 session 是否存在（只读查询 MongoDB）
- 首次连接时回放 MongoDB 中的历史事件快照（断线重连场景）
- 持续从 Redis Stream 拉取 pi-runtime 写入的增量输出，转成 SSE 事件推送给客户端

**不负责**（均由 `gateway` 负责）：
- 创建 / 关闭 session，发送消息，中断任务
- 向 pi-runtime 派发任务（写 Redis Stream `agent:tasks`）
- 任何 MongoDB / Redis 写操作
- Skill / MCP 配置查询

---

## API

### `GET /sessions/{session_id}/stream` — 全量历史流

`Content-Type: text/event-stream`

先回放 MongoDB 中的 `events_snapshot`（历史消息），再持续从 Redis Stream 拉取增量输出。
支持断线重连：通过 `last_seq` 参数跳过已接收消息。

### `GET /sessions/{session_id}/turns/{turn_id}/stream` — 按轮次订阅流

只订阅单个轮次的输出，适合轻量级客户端场景。前端发送消息后即用此接口实时接收响应。

**查询参数**（两个接口一致）：
- `last_seq`（可选，默认 `0`）：断线重连时传入上次收到的 Redis Stream ID，跳过已接收消息

**响应事件类型**：

| event 名 | 含义 | data 格式 |
|----------|------|-----------|
| `snapshot` | 历史事件快照（仅 `/stream`，断线重连时回放）| `{"events": [...]}` |
| `token` | pi 生成的文本 token | 原始文本 |
| `tool_call` | pi 调用工具 | `{"name": "bash", "input": {...}}` |
| `tool_result` | 工具执行结果 | `{"name": "bash", "output": "..."}` |
| `done` | 任务完成 | `""` |
| `error` | 任务出错 | 错误信息文本 |
| `cancelled` | 任务被中断（仅按轮次订阅）| `""` |
| `heartbeat` | 保活心跳（`SSE_BLOCK_MS` 一次）| `""` |

**断线重连示例：**
```bash
curl -N "http://localhost:8001/sessions/SESSION_ID/stream?last_seq=1718000000000-0"
```

---

## 内部实现

```
客户端
  │ GET /sessions/{id}/stream
  ▼
routes/stream.py
  ├── mongo_client.get_session（只读，判断存在性 + 读取历史快照）
  └── redis_client.stream_session_output → XREAD BLOCK session:{id}:stream
```

---

## 依赖关系

| 依赖 | 用途 | 连接方式 |
|------|------|---------|
| MongoDB | 只读查询 session 文档 | motor（async）|
| Redis | 只读订阅输出流（XREAD） | redis[asyncio] |

**不依赖**：admin、mcp-proxy、pi-runtime（gateway-sse 不调用任何其他服务）

---

## 扩容策略

按**并发 SSE 连接数**（而非 QPS）决定副本数与单实例资源上限：

- 每个 SSE 长连接在阻塞 `XREAD` 期间会独占一条 Redis 连接池连接，`REDIS_MAX_CONNECTIONS`
  需按单实例可承载的最大并发连接数配置，而不是按 API 请求量估算。
- 单实例的内存占用与并发连接数近似线性相关（每条连接一个协程 + 一个事件生成器），
  容量规划时应以"连接数"而非"请求数"为核心指标。
- 生产集群多副本部署时，需要在前面接入支持多后端的反向代理（详见
  [docker-compose.prod.yml](../docker-compose.prod.yml) 中的说明），当前单节点
  nginx 配置直连服务名，仅适配单实例。

---

## 配置

| 环境变量 | 说明 | 默认值 |
|---------|------|-------|
| `MONGO_URI` | MongoDB 连接串 | `mongodb://mongo:27017` |
| `MONGO_DB` | 数据库名 | `pi_agent` |
| `REDIS_URL` | Redis 连接串 | `redis://redis:6379` |
| `REDIS_MAX_CONNECTIONS` | Redis 连接池大小（按并发 SSE 连接数配置） | `200` |
| `GATEWAY_SSE_HOST` | 监听地址 | `0.0.0.0` |
| `GATEWAY_SSE_PORT` | 监听端口 | `8001` |
| `SSE_BLOCK_MS` | SSE 拉取阻塞超时（心跳间隔）| `5000` |
