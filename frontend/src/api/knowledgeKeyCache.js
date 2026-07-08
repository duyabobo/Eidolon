const KEY_STORAGE = "pi_knowledge_key";
const FP_STORAGE = "pi_knowledge_config_fp";
let sceneUid = "";
export function setKnowledgeSceneUid(uid) {
    sceneUid = (uid || "").trim();
}
export function getKnowledgeSceneUid() {
    return sceneUid;
}
export function buildConfigFingerprint(cfg, uid) {
    return `${cfg.environment || "local"}|${(cfg.base_url || "").trim()}|${(uid || "").trim()}`;
}
export function readCachedKnowledgeKey(cfg, uid) {
    const fp = buildConfigFingerprint(cfg, uid);
    if (sessionStorage.getItem(FP_STORAGE) !== fp)
        return null;
    return sessionStorage.getItem(KEY_STORAGE);
}
export function writeCachedKnowledgeKey(cfg, uid, key) {
    sessionStorage.setItem(KEY_STORAGE, key);
    sessionStorage.setItem(FP_STORAGE, buildConfigFingerprint(cfg, uid));
}
export function clearCachedKnowledgeKey() {
    sessionStorage.removeItem(KEY_STORAGE);
    sessionStorage.removeItem(FP_STORAGE);
}
export function getCachedKnowledgeKeyHeader() {
    const key = sessionStorage.getItem(KEY_STORAGE);
    return key ? { "X-Knowledge-Key": key } : {};
}
export function getSceneUidHeader() {
    return sceneUid ? { "X-Scene-Uid": sceneUid } : {};
}
