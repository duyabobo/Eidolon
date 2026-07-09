export const TRACE_HEADER = "X-Trace-Id";

export function createTraceId(): string {
  return crypto.randomUUID().replace(/-/g, "");
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
