/**
 * 按 Skill 的 mcp_tools 白名单生成 pi-mcp-adapter 配置：
 * - mcp.json：directTools + toolPrefix=none，让工具以原始名出现在模型 tool list
 * - mcp-cache.json：启动前预热 metadata，避免「首次无 cache → 回退仅 proxy」
 *
 * Skill frontmatter 的 mcp_tools 只负责 mcp-proxy 侧过滤（X-Mcp-Tools）；
 * 若不写 directTools，adapter 默认只有一个 mcp 网关，模型看不到 wiki_* 等具体工具。
 */
import { createHash } from "crypto";
import { writeFile } from "fs/promises";
import http from "http";
import { join } from "path";

const MCP_PROXY_SERVER_NAME = "mcp-proxy";
/** 沙盒内 bridge.js 桥接端口默认值，与 extensions/sandbox-init/bridge.js 保持一致 */
const DEFAULT_MCP_BRIDGE_PORT = 8080;
/** pi-mcp-adapter 调 mcp-proxy 的 tools/call 超时；默认 SDK 约 60s，arxiv 外网常不够 */
const MCP_PROXY_REQUEST_TIMEOUT_MS = 180_000;
const CACHE_VERSION = 1;

/**
 * 沙盒内 mcp.json 指向的 loopback 地址。
 * Linux 下固定 8080（bwrap 每 session 独立网络命名空间，不会冲突）；
 * macOS 下由 sandbox-ports.ts 按 session 动态分配，避免与真实 mcp-proxy/其他并发
 * session 冲突（见 pi-runtime/src/sandbox-macos.ts 顶部说明）。
 */
function mcpProxyLoopbackUrl(bridgePort: number = DEFAULT_MCP_BRIDGE_PORT): string {
  return `http://127.0.0.1:${bridgePort}/mcp`;
}

export interface McpDirectToolsSetup {
  userId: string;
  toolNames: string[];
  mcpProxyHost: string;
  mcpProxyPort: number;
}

interface CachedTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined || typeof value !== "object") {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? "undefined" : serialized;
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`).join(",")}}`;
}

/** 与 pi-mcp-adapter computeServerHash 对齐（url-only 的 mcp-proxy 条目）。 */
export function computeMcpProxyConfigHash(bridgePort?: number): string {
  const identity = {
    command: undefined,
    args: undefined,
    env: undefined,
    cwd: undefined,
    url: mcpProxyLoopbackUrl(bridgePort),
    headers: undefined,
    auth: undefined,
    bearerToken: undefined,
    bearerTokenEnv: undefined,
    exposeResources: undefined,
    excludeTools: undefined,
  };
  return createHash("sha256").update(stableStringify(identity)).digest("hex");
}

export function buildMcpJson(directTools?: string[], bridgePort?: number): object {
  const serverEntry: Record<string, unknown> = {
    url: mcpProxyLoopbackUrl(bridgePort),
    requestTimeoutMs: MCP_PROXY_REQUEST_TIMEOUT_MS,
  };
  if (directTools && directTools.length > 0) {
    serverEntry.directTools = [...directTools];
  }
  return {
    // 原始工具名与 Skill 正文一致（不要变成 mcp_proxy_wiki_...）
    settings: {
      toolPrefix: "none",
      requestTimeoutMs: MCP_PROXY_REQUEST_TIMEOUT_MS,
    },
    mcpServers: {
      [MCP_PROXY_SERVER_NAME]: serverEntry,
    },
  };
}

async function fetchToolsList(
  host: string,
  port: number,
  userId: string,
  toolNames?: string[],
): Promise<CachedTool[]> {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
  });

  const payload = await new Promise<string>((resolve, reject) => {
    const headers: Record<string, string | number> = {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(body),
      "x-user-id": userId,
    };
    // 有白名单才带 X-Mcp-Tools；缺省表示加载用户可见的全部 MCP 工具
    if (toolNames && toolNames.length > 0) {
      headers["x-mcp-tools"] = toolNames.join(",");
    }
    const req = http.request(
      {
        hostname: host,
        port,
        path: "/mcp",
        method: "POST",
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });

  const parsed = JSON.parse(payload) as {
    result?: { tools?: Array<{ name?: string; description?: string; inputSchema?: unknown }> };
    error?: { message?: string };
  };
  if (parsed.error) {
    throw new Error(parsed.error.message || "tools/list 失败");
  }

  return (parsed.result?.tools ?? [])
    .filter((tool) => tool?.name)
    .map((tool) => ({
      name: String(tool.name),
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
}

/**
 * 拉取用户当前可见的全部 MCP 工具名（无 skill 白名单时写入 directTools）。
 * 失败抛错，由调用方决定是否降级为仅 mcp 网关。
 */
export async function listAllMcpToolNames(
  userId: string,
  mcpProxyHost: string,
  mcpProxyPort: number,
): Promise<string[]> {
  const tools = await fetchToolsList(mcpProxyHost, mcpProxyPort, userId);
  return tools.map((t) => t.name).filter(Boolean).sort();
}

/**
 * 写入 mcp.json；若有白名单则预热 mcp-cache.json，使 directTools 首轮即可注册。
 *
 * @param bridgePort 沙盒内 mcp.json 指向的 loopback 端口（沙盒内地址，与 setup 里
 *   mcpProxyHost/mcpProxyPort 指代的真实 mcp-proxy 地址是两个不同的概念——后者仅用于
 *   本函数向真实 mcp-proxy 预热 tools/list 缓存）。缺省为 Linux 固定端口 8080。
 */
export async function writeSessionMcpAdapterConfig(
  piConfigDir: string,
  setup?: McpDirectToolsSetup,
  bridgePort?: number,
): Promise<void> {
  const directTools = setup?.toolNames?.length ? setup.toolNames : undefined;
  await writeFile(join(piConfigDir, "mcp.json"), JSON.stringify(buildMcpJson(directTools, bridgePort), null, 2));

  if (!setup || !directTools) {
    return;
  }

  try {
    const tools = await fetchToolsList(
      setup.mcpProxyHost,
      setup.mcpProxyPort,
      setup.userId,
      setup.toolNames,
    );
    const cache = {
      version: CACHE_VERSION,
      servers: {
        [MCP_PROXY_SERVER_NAME]: {
          configHash: computeMcpProxyConfigHash(bridgePort),
          tools,
          resources: [] as unknown[],
          cachedAt: Date.now(),
        },
      },
    };
    await writeFile(join(piConfigDir, "mcp-cache.json"), JSON.stringify(cache, null, 2));
    console.log(
      `[session-mcp-config] directTools 已配置并预热 cache tools=${tools.map((t) => t.name).join(",")}`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // 预热失败不阻断启动：仍有 mcp.json directTools，adapter 可后台补 cache，首轮可能仍走 proxy
    console.warn(`[session-mcp-config] mcp-cache 预热失败，仍写入 directTools: ${message}`);
  }
}
