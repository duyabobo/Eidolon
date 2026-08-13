import { createServer } from "net";

const LOOPBACK_HOST = "127.0.0.1";

/**
 * 让操作系统分配一个当前空闲的 loopback 端口（bind 0 拿到的端口），用于
 * cm-server / pi-runtime / 本机静态代理服务器三者的监听端口——桌面单机场景
 * 不需要固定端口号，随机分配可以避免与用户机器上其他服务冲突。
 */
export function allocateFreeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, LOOPBACK_HOST, () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") {
          resolve(address.port);
        } else {
          reject(new Error("无法解析已分配的端口"));
        }
      });
    });
  });
}

export async function allocateAppPorts(): Promise<{
  cmServerPort: number;
  piRuntimePort: number;
  staticServerPort: number;
  arxivMcpPort: number;
  natureMcpPort: number;
}> {
  const [cmServerPort, piRuntimePort, staticServerPort, arxivMcpPort, natureMcpPort] = await Promise.all([
    allocateFreeLoopbackPort(),
    allocateFreeLoopbackPort(),
    allocateFreeLoopbackPort(),
    allocateFreeLoopbackPort(),
    allocateFreeLoopbackPort(),
  ]);
  return { cmServerPort, piRuntimePort, staticServerPort, arxivMcpPort, natureMcpPort };
}
