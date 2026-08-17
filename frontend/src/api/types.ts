/** 跨 api 模块共享的类型定义，避免 config/mcp/knowledge 各自重复声明。 */

/** 服务连通性/连通测试的统一返回（LLM、Mineru 等测试接口通用）。 */
export interface ServiceTestResult {
  ok: boolean;
  latency_ms: number;
  message: string;
}

/** MCP Server 配置（url 类型，仅 HTTP/SSE 远程端点）。 */
export interface McpServerConfig {
  url: string;
  description?: string;
  enabled?: boolean;
  api_key?: string;
}
