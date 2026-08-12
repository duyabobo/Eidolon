/** 未设置用户 ID 时的默认值 */
export const DEFAULT_USER_ID = "0";
export function resolveUserId(raw) {
    const trimmed = (raw ?? "").trim();
    return trimmed || DEFAULT_USER_ID;
}
