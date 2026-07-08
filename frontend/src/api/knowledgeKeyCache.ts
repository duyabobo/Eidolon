import type { KnowledgeServiceConfig } from "./knowledge";

const KEY_STORAGE = "pi_knowledge_key";
const FP_STORAGE = "pi_knowledge_config_fp";

export function buildConfigFingerprint(cfg: KnowledgeServiceConfig): string {
  return `${cfg.environment || "local"}|${(cfg.base_url || "").trim()}|${(cfg.scene_uid || "").trim()}`;
}

export function readCachedKnowledgeKey(cfg: KnowledgeServiceConfig): string | null {
  const fp = buildConfigFingerprint(cfg);
  if (sessionStorage.getItem(FP_STORAGE) !== fp) return null;
  return sessionStorage.getItem(KEY_STORAGE);
}

export function writeCachedKnowledgeKey(cfg: KnowledgeServiceConfig, key: string): void {
  sessionStorage.setItem(KEY_STORAGE, key);
  sessionStorage.setItem(FP_STORAGE, buildConfigFingerprint(cfg));
}

export function clearCachedKnowledgeKey(): void {
  sessionStorage.removeItem(KEY_STORAGE);
  sessionStorage.removeItem(FP_STORAGE);
}

export function getCachedKnowledgeKeyHeader(): Record<string, string> {
  const key = sessionStorage.getItem(KEY_STORAGE);
  return key ? { "X-Knowledge-Key": key } : {};
}
