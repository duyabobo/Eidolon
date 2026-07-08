import type { KnowledgeServiceConfig } from "./knowledge";

const KEY_STORAGE = "pi_knowledge_key";
const FP_STORAGE = "pi_knowledge_config_fp";

let sceneUid = "";

export function setKnowledgeSceneUid(uid: string): void {
  sceneUid = (uid || "").trim();
}

export function getKnowledgeSceneUid(): string {
  return sceneUid;
}

export function buildConfigFingerprint(cfg: KnowledgeServiceConfig, uid: string): string {
  return `${cfg.environment || "local"}|${(cfg.base_url || "").trim()}|${(uid || "").trim()}`;
}

export function readCachedKnowledgeKey(cfg: KnowledgeServiceConfig, uid: string): string | null {
  const fp = buildConfigFingerprint(cfg, uid);
  if (sessionStorage.getItem(FP_STORAGE) !== fp) return null;
  return sessionStorage.getItem(KEY_STORAGE);
}

export function writeCachedKnowledgeKey(cfg: KnowledgeServiceConfig, uid: string, key: string): void {
  sessionStorage.setItem(KEY_STORAGE, key);
  sessionStorage.setItem(FP_STORAGE, buildConfigFingerprint(cfg, uid));
}

export function clearCachedKnowledgeKey(): void {
  sessionStorage.removeItem(KEY_STORAGE);
  sessionStorage.removeItem(FP_STORAGE);
}

export function getCachedKnowledgeKeyHeader(): Record<string, string> {
  const key = sessionStorage.getItem(KEY_STORAGE);
  return key ? { "X-Knowledge-Key": key } : {};
}

export function getSceneUidHeader(): Record<string, string> {
  return sceneUid ? { "X-Scene-Uid": sceneUid } : {};
}
