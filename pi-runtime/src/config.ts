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
    },
  },
} as const;
