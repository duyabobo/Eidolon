export const config = {
  // 单机单用户：gateway 直接以 HTTP 调用本服务派发任务/取消/关闭（替代原 Redis Stream/Pub-Sub），
  // 本服务反过来以 HTTP 调用 gateway 回写 session 状态、调用 gateway-sse 推送 SSE 增量事件。
  server: {
    port: Number(process.env.PI_RUNTIME_PORT ?? 8090),
  },
  // gateway / gateway-sse 已合并进 cm-server 单进程单端口，两个 baseUrl 默认指向同一地址；
  // 仍保留两个独立配置项（而不是合并成一个）是为了不改动调用方按"gateway API" /
  // "gateway-sse API" 分类的代码结构，未来若两者再拆分部署，只需改这两个默认值。
  gateway: {
    baseUrl: process.env.GATEWAY_BASE_URL ?? "http://cm-server:8000",
  },
  gatewaySse: {
    baseUrl: process.env.GATEWAY_SSE_BASE_URL ?? "http://cm-server:8000",
  },
  // llm-proxy / mcp-proxy 已合并进 cm-server，沙盒内 bridge.js 转发的目标host/port
  // 默认也指向同一进程；此前这两组 host/port 分散在 worker.ts 六处读取环境变量，
  // 现集中到这里，worker.ts 只引用 config.llmProxy / config.mcpProxy。
  llmProxy: {
    host: process.env.LLM_PROXY_HOST ?? "cm-server",
    port: Number(process.env.LLM_PROXY_PORT ?? 8000),
  },
  mcpProxy: {
    host: process.env.MCP_PROXY_HOST ?? "cm-server",
    port: Number(process.env.MCP_PROXY_PORT ?? 8000),
  },
  sandbox: {
    root: process.env.SANDBOX_ROOT ?? "/data/sandboxes",
    /**
     * true：bwrap 不传 --unshare-net，沙盒可访问宿主机/容器网络。
     * false（默认）：--unshare-net，仅 Unix socket 桥可出站。
     */
    networkEnabled: (process.env.SANDBOX_NETWORK_ENABLED ?? "false").toLowerCase() === "true",
    cgroup: {
      enabled: (process.env.SANDBOX_CGROUP_ENABLED ?? "true").toLowerCase() !== "false",
      basePath: process.env.SANDBOX_CGROUP_BASE ?? "",
      memoryMax: process.env.SANDBOX_CGROUP_MEMORY_MAX ?? "512M",
      cpuMax: process.env.SANDBOX_CGROUP_CPU_MAX ?? "max",
      /** RLIMIT_AS 降级默认关闭：会限制 bwrap+pi+bridge 整树，512M 易导致 node OOM */
      prlimitFallback: (process.env.SANDBOX_PRLIMIT_FALLBACK ?? "false").toLowerCase() === "true",
    },
  },
} as const;
