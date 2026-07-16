/** 未设置用户 ID 时的默认值 */
export const DEFAULT_USER_ID = "0";

export function resolveUserId(raw: string | null | undefined): string {
  const trimmed = (raw ?? "").trim();
  return trimmed || DEFAULT_USER_ID;
}
