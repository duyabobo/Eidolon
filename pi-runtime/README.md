# Pi-Runtime 服务（Agent 执行引擎）

## 职责边界

Pi-Runtime 是平台的执行核心，负责：

- 本机 HTTP 服务：接收 gateway 直连派发的 session 任务与 cancel/close 控制信号
- 为每个 session 创建 bwrap 沙盒（文件系统 + 网络双重隔离）
- 启动 Unix socket 桥，为沙盒提供受控的网络白名单出口
- 以 RPC 模式在沙盒内启动 pi agent，执行用户请求
- 将 pi 生成的 token / 工具调用 / 结果以 HTTP 实时推送给 gateway-sse，供 SSE 转发
- 任务完成后销毁沙盒，通过 HTTP 通知 gateway 更新 session 状态（落本地 SQLite）

**不负责**：
- 用户认证 / session 创建（由 cm-server 内的 gateway 模块负责）
- LLM 直连（通过 cm-server 内的 llm-proxy 模块代理）
- MCP 工具调用（通过 cm-server 内的 mcp-proxy 模块代理）
- MCP / LLM / Skill 配置管理（由 cm-server 负责，本服务只读）

> gateway / gateway-sse / admin / llm-proxy / mcp-proxy 已合并为单进程 `cm-server`
> （见 [../cm-server/README.md](../cm-server/README.md)），本文档中提到的这几个名字
> 现在都指 cm-server 内部按原服务边界划分的模块，不是独立部署单元；pi-runtime
> 与它们之间仍然是本机 HTTP 调用，只是目标地址统一成了 cm-server 的一个端口。

单机单用户场景下只有一个 pi-runtime 实例，不存在多实例竞争消费/横向扩容问题，
因此没有 Consumer Group、执行租约续期、user→instance 亲和绑定、实例心跳等分布式路由机制。

---

## 核心组件

```
pi-runtime/
├── src/
│   ├── worker.ts          主入口：session 调度 + socket bridge 启动 + 关停清理
│   ├── http-server.ts     本机 HTTP 入口：/tasks、/sessions/:id/turns/:id/cancel、
│   │                      /sessions/:id/close、/sessions/:id/active_turn（gateway 直连调用）
│   ├── gateway-client.ts  HTTP 调用 gateway：写 session 状态 / events_snapshot
│   ├── pi-session.ts      启动 pi RPC 进程（在沙盒内），解析 JSONL 输出
│   ├── sandbox.ts         bwrap 沙盒生命周期（创建 / 销毁）+ 外层 bwrap 参数构建
│   ├── socket-bridge.ts   Unix socket 代理服务器（LLM / MCP 网络白名单）
│   ├── output-stream.ts   HTTP 推送增量事件给 gateway-sse + 批量落 events_snapshot
│   └── skill-mcp.ts       调用 gateway `GET /skills` 解析 Skill → MCP 工具白名单
└── extensions/
    ├── bwrap/            Pi 扩展：路径白名单校验（read/write/edit），bash 工具适配
    └── sandbox-init/     沙盒启动脚本：启用 loopback + TCP↔Unix socket 桥
```

---

## 任务处理流程

```
gateway: POST http://pi-runtime:8090/tasks
  { task_id, task_type: start|message, session_id, user_id, request, turn_id, skill_ids }
  │
  ▼
http-server.ts: 校验字段，202 立即返回，fire-and-forget 转交 worker.ts
  │
  ▼
worker.ts: handleIncomingTask
  │
  ├─ 1. updateSessionStatus → HTTP 通知 gateway，落 SQLite RUNNING
  ├─ 2. createSandbox → 创建 /data/sandboxes/users/{uid}/sessions/{sid}/
  │                       workspace/  home/  tmp/
  │
  ├─ 3. startPiSession
  │       ├── 写 /tmp/pi-config/{sid}/mcp.json（指向沙盒内 mcp-proxy 桥）
  │       ├── 写 /tmp/pi-config/{sid}/models.json（指向沙盒内 llm-proxy 桥）
  │       ├── bwrap 外层沙盒启动 sandbox-init.sh
  │       │     ├── ip link set lo up（启用 loopback）
  │       │     ├── bridge.js（127.0.0.1:9001 ↔ llm.sock，127.0.0.1:8080 ↔ mcp.sock）
  │       │     └── exec pi --mode rpc
  │       ├── 发送 prompt → pi stdin
  │       └── 解析 pi stdout JSONL，每条事件即时 POST 给 gateway-sse `/internal/events`：
  │             text event      → event_type=token
  │             tool_call event → event_type=tool_call
  │             tool_result     → event_type=tool_result
  │             done event      → event_type=done
  │
  ├─ 4. output-stream.ts 按批量阈值/定时器把非终止事件 POST 给 gateway `/internal/sessions/:id/events`
  │       （events_snapshot，供断线重连回放），done/error 单独触发一次 flush
  ├─ 5. updateSessionStatus → HTTP 通知 gateway，落 SQLite COMPLETED
  └─ 6. session 闲置超时/正常关闭 → destroySandbox → 删除 session 沙盒目录
```

---

## 沙盒安全架构

### 双重隔离设计

pi 进程本身运行在外层 bwrap 沙盒内，不仅 bash 命令被隔离，pi 进程本身也被完全隔离：

```
┌─────────────────────────────────────────────────────────┐
│  pi-runtime（宿主进程，有网）                             │
│  session socket:                                        │
│    /tmp/pi-socks/sessions/{sessionId}/llm.sock → llm    │
│    /tmp/pi-socks/sessions/{sessionId}/mcp.sock → mcp    │
│                                                         │
│  ┌──────────────────────────────────────────────────┐  │
│  │  bwrap 沙盒（--unshare-net，per session）         │  │
│  │  （tmpfs 覆盖 SOCKS_DIR，仅 ro-bind 本 session）  │  │
│  │                                                  │  │
│  │  bridge.js: 127.0.0.1:9001 ↔ llm.sock           │  │
│  │             127.0.0.1:8080 ↔ mcp.sock           │  │
│  │                                                  │  │
│  │  pi（--mode rpc）                                │  │
│  │    LLM 调用 → http://127.0.0.1:9001/v1          │  │
│  │    MCP 调用 → http://127.0.0.1:8080/mcp         │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### bwrap 挂载策略

| 挂载参数 | 目录 | 权限 | 说明 |
|---------|------|------|------|
| `--ro-bind / /` | 根文件系统 | 只读 | 提供系统工具、pi 可执行文件 |
| `--tmpfs {sandboxRoot}` | 沙盒根目录 | 内存覆盖 | 对沙盒内隐藏其他 session 数据 |
| `--bind {workspace}` | session 工作目录 | 读写 | pi 的文件操作目标 |
| `--bind {home}` | session home | 读写 | .bashrc / pip 包路径 |
| `--bind {tmp}` | session tmp | 读写 | 临时文件 |
| `--bind {piConfigDir}` | pi config 目录 | 读写 | mcp.json / models.json / bwrap.ready |
| `--tmpfs /tmp/pi-socks` | sock 根目录 | 覆盖 | 清空整棵 sock 树，阻断跨 session 可见 |
| `--ro-bind .../sessions/{id}` | 本 session sock | **只读** | 仅暴露本会话 llm/mcp.sock |
| `--unshare-net` | — | — | 完全断网（`SANDBOX_NETWORK_ENABLED=false`）；联网时省略 |
| `--unshare-pid` | — | — | 独立 PID 空间 |

### 网络白名单安全性

沙盒内只看得到本 session 的 Unix socket：

- 整棵 `/tmp/pi-socks` 先用 tmpfs 覆盖，同机其他 session 的 sock 不可见
- 再只读挂载 `sessions/{sessionId}/`，pi 只能 **connect** 本会话出口
- `--unshare-net` 切断所有其他网络出口（`SANDBOX_NETWORK_ENABLED=true` 时不启用）
- socket 文件由 pi-runtime 在沙盒外创建；身份头（session / user）由 runtime 桥注入，沙盒不可伪造

### pi 沙盒内无法访问的内容

| 资源 | 隔离方式 |
|------|---------|
| cm-server 内部接口（原 gateway/gateway-sse/admin） | 无凭据，无网络 |
| 其他 session 的文件 | `--tmpfs {sandboxRoot}` 覆盖 |
| 其他 session 的 sock | `--tmpfs /tmp/pi-socks` + 仅 bind 本 session |
| 外部网络 / 互联网 | `--unshare-net`（`SANDBOX_NETWORK_ENABLED=false`） |
| MCP Server（直连） | 无路由，只能经由 mcp-proxy |

### Session 资源上限（cgroup v2）

每个 session 的 bwrap 根进程在 spawn 后会加入独立 cgroup，限制整棵进程树（pi + bash 子进程）的 **内存 / CPU**：

| 限制项 | 环境变量 | 默认 |
|--------|---------|------|
| 开关 | `SANDBOX_CGROUP_ENABLED` | `true` |
| 内存 | `SANDBOX_CGROUP_MEMORY_MAX` | `512M` |
| CPU | `SANDBOX_CGROUP_CPU_MAX` | `max`（不限） |

- cgroup 路径：`{父 cgroup}/pi-sessions/{sessionId}/`
- 父 cgroup 默认从 `/proc/self/cgroup` 自动解析；可显式设置 `SANDBOX_CGROUP_BASE`
- **不限制磁盘**：workspace 在 NFS/卷上，配额需另行实现
- 若容器无 cgroup 写权限或创建失败，**自动降级**为 `prlimit --as` 内存限制（Docker 默认环境常见）
- session 结束（进程退出或 `close()`）时删除对应 cgroup

CPU 格式示例（cgroup v2 `cpu.max`）：`100000 100000` 表示约 1 核；`50000 100000` 表示约 0.5 核。

**宿主机委托配置**（启用完整 cgroup + CPU 配额）：见 [docs/sandbox-cgroup-delegation.md](../docs/sandbox-cgroup-delegation.md)。

### pi 全局扩展目录解析

`pi-session.ts` 启动每个 session 时，会把 `$HOME/.pi/agent/extensions` 下的全局扩展（`bwrap`、
`pi-mcp-adapter` 等，通过 `npm install -g @earendil-works/pi-coding-agent` 之类命令安装后落地
的位置）逐个软链接进该 session 独立的 `PI_CODING_AGENT_DIR`。用 `os.homedir()` 而不是硬编码
`/root/.pi/agent/extensions`：容器里以 root 运行时 `os.homedir()` 恰好也是 `/root`，行为不变；
Electron 桌面场景下 pi-runtime 以当前登录用户身份运行，`os.homedir()` 解析到该用户的真实
`$HOME`（如 `/Users/xxx`），这样同一份代码才能在两种环境下都找到扩展目录（Electron 打包相关
已知限制见 [../electron/README.md](../electron/README.md)：目前仍要求用户机器上已经装好
这些全局扩展，还没有做到「随应用安装」）。

### bwrap 扩展（extensions/bwrap）

pi 在外层沙盒内运行时（`PI_OUTER_SANDBOX=1`）：

| pi 工具 | 处理方式 |
|--------|---------|
| `bash` | 直接执行（继承外层沙盒的网络和文件系统隔离） |
| `read` / `write` / `edit` | 路径白名单校验（workspace + home 范围内） |
| `find` / `grep` / `ls` | 路径白名单校验 |

---

## Socket Bridge

每个 session 在宿主侧注册一对 Unix socket，作为该沙盒唯一网络出口：

```
/tmp/pi-socks/sessions/{sessionId}/llm.sock  →  cm-server:8000  （LLM 推理，原 llm-proxy 模块）
/tmp/pi-socks/sessions/{sessionId}/mcp.sock  →  cm-server:8000  （MCP 工具调用，原 mcp-proxy 模块）
```

沙盒内 bridge.js 按 `PI_SOCKS_LLM` / `PI_SOCKS_MCP` 连接上述路径；runtime 桥注入会话身份头后再转发到代理。

---

## 本机 HTTP 接口（gateway 直连调用）

| 接口 | 说明 |
|------|------|
| `POST /tasks` | 派发任务（`task_type: start` 创建 session / `message` 追加轮次），202 立即返回，异步执行 |
| `POST /sessions/:id/turns/:id/cancel` | 中断指定轮次的生成任务 |
| `POST /sessions/:id/close` | 关闭 session，销毁 pi 进程和沙盒 |
| `GET /sessions/:id/active_turn` | 查询该 session 当前进行中的 turn_id（读内存，无则 `null`） |
| `GET /health` | 健康检查 |

## 依赖关系

| 依赖 | 用途 | 方向 |
|------|------|------|
| cm-server（gateway 模块） | 接收任务派发/控制信号；反向写 session 状态、events_snapshot、读 Skill 列表 | HTTP 双向 |
| cm-server（gateway-sse 模块） | 推送轮次增量事件，供 SSE 转发 | HTTP 调用 |
| cm-server（llm-proxy 模块） | LLM 推理（经 Unix socket 桥） | HTTP 调用 |
| cm-server（mcp-proxy 模块） | MCP 工具调用（经 Unix socket 桥） | HTTP 调用 |
| 本地沙盒存储 | session sandbox 数据 | 读写 |

以上 4 行合并前是 4 个独立服务，合并后都是同一个 cm-server 进程、同一个端口，
区分成 4 行只是为了标注「本机 HTTP 调用打到 cm-server 的哪个模块」。

---

## 配置

| 环境变量 | 说明 | 默认值 |
|---------|------|-------|
| `PI_RUNTIME_PORT` | 本机 HTTP 服务监听端口 | `8090` |
| `LOG_DIR` | 日志落盘目录（容器路径 `/app/logs`，Electron 桌面场景需显式指向 `app.getPath('userData')/logs`，否则 `mkdirSync` 直接 ENOENT 崩溃） | `/app/logs` |
| `GATEWAY_BASE_URL` | cm-server 地址（写 session 状态/events/读 Skill 列表） | `http://cm-server:8000` |
| `GATEWAY_SSE_BASE_URL` | cm-server 地址（推送增量事件，与上面同一个进程） | `http://cm-server:8000` |
| `OPENAI_API_KEY` | LLM 内部 token（传给 pi） | `pi-agent-internal` |
| `SANDBOX_ROOT` | bwrap 沙盒根目录 | `/data/sandboxes` |
| `SANDBOX_NETWORK_ENABLED` | bwrap 是否允许联网（`true` 省略 `--unshare-net`） | `false` |
| `LLM_PROXY_HOST` | cm-server 主机名（沙盒内 bridge.js 转发目标） | `cm-server` |
| `LLM_PROXY_PORT` | cm-server 端口 | `8000` |
| `MCP_PROXY_HOST` | cm-server 主机名（沙盒内 bridge.js 转发目标） | `cm-server` |
| `MCP_PROXY_PORT` | cm-server 端口 | `8000` |
| `SANDBOX_CGROUP_ENABLED` | 是否启用 session cgroup 限制 | `true` |
| `SANDBOX_CGROUP_MEMORY_MAX` | 单 session 内存上限（如 `512M`、`1G`） | `512M` |
| `SANDBOX_CGROUP_CPU_MAX` | 单 session CPU 上限（cgroup v2 格式，如 `100000 100000`；`max` 不限） | `max` |
| `SANDBOX_CGROUP_BASE` | cgroup 父路径（空则自动检测） | 空 |

---

## Pi 版本管理

Dockerfile 中锁定 pi 版本：

```dockerfile
ARG PI_VERSION=0.79.9
RUN npm install -g @earendil-works/pi-coding-agent@${PI_VERSION}
```

升级前需验证 bwrap 扩展兼容性，详见 [extensions/bwrap/index.ts](extensions/bwrap/index.ts)。
