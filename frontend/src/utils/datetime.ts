/** 后端按东八区读写；API 可能带 +08:00，或 naive ISO（视为东八区墙钟）。 */

const CHINA_TIME_ZONE = "Asia/Shanghai";
const CHINA_OFFSET = "+08:00";

export function parseBackendDate(value: string | number | Date): Date {
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value);

  const raw = value.trim();
  if (!raw) return new Date(Number.NaN);

  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(raw)) {
    return new Date(raw);
  }
  // 无时区 ISO：后端约定为东八区墙钟
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) {
    return new Date(`${raw}${CHINA_OFFSET}`);
  }
  return new Date(raw);
}

export function formatChinaDateTime(
  value: string | number | Date,
  options: Intl.DateTimeFormatOptions = {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  },
): string {
  const date = parseBackendDate(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("zh-CN", { timeZone: CHINA_TIME_ZONE, ...options });
}
