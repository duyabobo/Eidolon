/**
 * 启动 pi 进程前，直接向 mcp-proxy 发 tools/list 预热缓存。
 *
 * 为什么直接调而不走 Unix socket 桥：
 *   桥依赖 pi 进程监听沙盒内的 loopback，pi 还没启动时桥不可用。
 *   这里直接 HTTP 调 mcp-proxy，仅为触发聚合器 refresh，不消费返回值。
 */
import http from "http";

const TOOLS_LIST_BODY = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });

export async function warmMcpCache(
  userId: string,
  mcpServerNames: string[] | undefined,
  host: string,
  port: number,
): Promise<void> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Content-Length": String(Buffer.byteLength(TOOLS_LIST_BODY)),
    "X-User-Id": userId,
  };
  if (mcpServerNames && mcpServerNames.length > 0) {
    headers["X-Mcp-Servers"] = mcpServerNames.join(",");
  }

  return new Promise((resolve) => {
    const req = http.request({ host, port, path: "/mcp", method: "POST", headers }, (res) => {
      res.resume();
      const filterHint = mcpServerNames ? mcpServerNames.join(",") : "ALL";
      console.log(
        `[mcp-warmup] user=${userId} mcp_servers=${filterHint}: 预热完成 status=${res.statusCode}`,
      );
      resolve();
    });
    req.on("error", (err) => {
      console.warn(`[mcp-warmup] user=${userId}: 预热失败（不阻塞启动）: ${err.message}`);
      resolve();
    });
    req.setTimeout(30_000, () => {
      console.warn(`[mcp-warmup] user=${userId}: 预热超时（不阻塞启动）`);
      req.destroy();
      resolve();
    });
    req.write(TOOLS_LIST_BODY);
    req.end();
  });
}
