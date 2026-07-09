export const config = {
  redis: {
    url: process.env.REDIS_URL ?? "redis://redis:6379",
    taskChannel: "sessions:new",
  },
  mongo: {
    uri: process.env.MONGO_URI ?? "mongodb://mongo:27017",
    db: process.env.MONGO_DB ?? "pi_agent",
  },
  sandbox: {
    root: process.env.SANDBOX_ROOT ?? "/data/sandboxes",
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
