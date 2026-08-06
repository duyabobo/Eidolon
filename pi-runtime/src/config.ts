export const config = {
  redis: {
    url: process.env.REDIS_URL ?? "redis://redis:6379",
    taskStream: process.env.TASK_STREAM ?? "agent:tasks",
    taskGroup: process.env.TASK_CONSUMER_GROUP ?? "pi-runtime-workers",
    taskDlqStream: process.env.TASK_DLQ_STREAM ?? "agent:tasks:dlq",
    taskBlockMs: Number(process.env.TASK_BLOCK_MS ?? 5_000),
    taskReadCount: Number(process.env.TASK_READ_COUNT ?? 10),
    taskClaimIdleMs: Number(process.env.TASK_CLAIM_IDLE_MS ?? 15 * 60_000),
    taskClaimIntervalMs: Number(process.env.TASK_CLAIM_INTERVAL_MS ?? 30_000),
    taskClaimCount: Number(process.env.TASK_CLAIM_COUNT ?? 10),
    // 必须小于 claim idle：消费者崩溃后，租约先过期，再由 XAUTOCLAIM 接管。
    taskLeaseMs: Number(process.env.TASK_LEASE_MS ?? 14 * 60_000),
    taskLeaseRenewMs: Number(process.env.TASK_LEASE_RENEW_MS ?? 30_000),
    taskMaxAttempts: Number(process.env.TASK_MAX_ATTEMPTS ?? 3),
  },
  mongo: {
    uri: process.env.MONGO_URI ?? "mongodb://mongo:27019",
    db: process.env.MONGO_DB ?? "pi_agent",
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
