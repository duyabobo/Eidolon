const KEY_STORAGE = "pi_knowledge_key";
const FP_STORAGE = "pi_knowledge_config_fp";
export function buildConfigFingerprint(cfg) {
    return `${(cfg.base_url || "").trim()}|${(cfg.scene_uid || "").trim()}`;
}
export function readCachedKnowledgeKey(cfg) {
    const fp = buildConfigFingerprint(cfg);
    if (sessionStorage.getItem(FP_STORAGE) !== fp)
        return null;
    return sessionStorage.getItem(KEY_STORAGE);
}
export function writeCachedKnowledgeKey(cfg, key) {
    sessionStorage.setItem(KEY_STORAGE, key);
    sessionStorage.setItem(FP_STORAGE, buildConfigFingerprint(cfg));
}
export function clearCachedKnowledgeKey() {
    sessionStorage.removeItem(KEY_STORAGE);
    sessionStorage.removeItem(FP_STORAGE);
}
export function getCachedKnowledgeKeyHeader() {
    const key = sessionStorage.getItem(KEY_STORAGE);
    return key ? { "X-Knowledge-Key": key } : {};
}
