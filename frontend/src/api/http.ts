import { randomUUID } from "../utils/id";

export const TRACE_HEADER = "X-Trace-Id";

export function createTraceId(): string {
  return randomUUID().replace(/-/g, "");
}

export function mergeTraceHeaders(
  headers?: HeadersInit,
  options?: { json?: boolean },
): Record<string, string> {
  const merged = new Headers(headers);
  if (!merged.has(TRACE_HEADER)) {
    merged.set(TRACE_HEADER, createTraceId());
  }
  const useJson = options?.json ?? false;
  if (useJson && !merged.has("Content-Type")) {
    merged.set("Content-Type", "application/json");
  }
  const out: Record<string, string> = {};
  merged.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

export async function apiFetch(url: string, options: RequestInit = {}): Promise<Response> {
  return fetch(url, {
    ...options,
    headers: mergeTraceHeaders(options.headers, { json: true }),
  });
}

/**
 * 从 FastAPI 错误响应体中提取可读 detail：
 * - 字符串直接返回（业务错误）
 * - 数组（Pydantic 校验错误）逐条取 msg 拼接
 * - 其它（缺 detail 或无法识别）返回 null，由调用方回退到 HTTP 状态码
 */
function parseErrorDetail(body: unknown): string | null {
  const detail = (body as { detail?: unknown } | null | undefined)?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const msgs = detail
      .map((d) => (typeof d === "object" && d !== null && "msg" in d ? (d as { msg?: unknown }).msg : d))
      .filter((m): m is string => typeof m === "string");
    return msgs.join("; ");
  }
  return null;
}

/** 统一错误抛出：非 2xx 时解析 detail 并抛 Error。 */
export async function throwIfNotOk(resp: Response): Promise<void> {
  if (resp.ok) return;
  const body = await resp.json().catch(() => ({}));
  throw new Error(parseErrorDetail(body) ?? `HTTP ${resp.status}`);
}

/**
 * 统一 JSON 请求助手：各 api 模块共用，替代原先分散的 request<T> 副本。
 * 附带 no-store（避免浏览器缓存 GET）与 204 空响应处理。
 */
export async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const resp = await apiFetch(url, { cache: "no-store", ...options });
  await throwIfNotOk(resp);
  if (resp.status === 204) return undefined as T;
  return resp.json();
}
