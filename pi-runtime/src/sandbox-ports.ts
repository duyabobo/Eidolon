/**
 * session 沙盒桥接端口分配。
 *
 * Linux（bwrap --unshare-net）：每个 session 的网络命名空间互相隔离，
 * 沙盒内 127.0.0.1:9001/8080 与宿主机的同名端口是完全不同的地址空间，
 * 所有 session 固定复用这两个端口不会冲突。
 *
 * macOS（sandbox-exec）：Seatbelt 没有网络命名空间概念，bridge.js 只能绑定在
 * 宿主机真实的 loopback 上，与真实的 llm-proxy/mcp-proxy 端口共享同一地址空间。
 * 固定端口会导致两个问题：
 *   1. 与真实的 llm-proxy(9001)/mcp-proxy(8080) 端口冲突（同机直跑，非容器网络隔离）
 *   2. 并发多 session 时彼此的 bridge 端口冲突
 * 因此 macOS 下必须为每个 session 动态分配一对未被占用的端口。
 */
import net from "net";
import { config } from "./config";

export interface SessionBridgePorts {
  llmPort: number;
  mcpPort: number;
}

/** Linux 下固定复用的桥接端口，需与 bridge.js 默认值保持一致 */
const FIXED_LLM_BRIDGE_PORT = 9001;
const FIXED_MCP_BRIDGE_PORT = 8080;

function allocateFreeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : null;
      probe.close(() => {
        if (port) {
          resolve(port);
        } else {
          reject(new Error("无法分配空闲端口"));
        }
      });
    });
  });
}

/**
 * 分配本 session 的 LLM/MCP 桥接端口。
 *
 * 存在极小概率的 TOCTOU 竞态（探测端口关闭后、bridge.js 实际监听前被其他进程抢占），
 * 单机单用户场景发生概率极低，可接受；bridge.js 监听失败会打日志但不阻断 session。
 */
export async function allocateSessionBridgePorts(): Promise<SessionBridgePorts> {
  if (process.platform !== "darwin") {
    return { llmPort: FIXED_LLM_BRIDGE_PORT, mcpPort: FIXED_MCP_BRIDGE_PORT };
  }
  const [llmPort, mcpPort] = await Promise.all([
    allocateFreeLoopbackPort(),
    allocateFreeLoopbackPort(),
  ]);
  console.log(`[sandbox-ports] macOS 动态分配桥接端口 llm=${llmPort} mcp=${mcpPort}`);
  return { llmPort, mcpPort };
}

export function isMacosSandbox(): boolean {
  return process.platform === "darwin";
}

/** Linux 下沙盒是否允许联网，由 config 决定；macOS 下 Seatbelt profile 复用同一开关 */
export function sandboxNetworkEnabled(): boolean {
  return config.sandbox.networkEnabled;
}
