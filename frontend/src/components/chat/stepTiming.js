/** 消息时间戳展示：今天仅时分秒，跨天带月日 */
export function formatMessageTime(ts) {
    if (ts == null || !Number.isFinite(ts))
        return null;
    const date = new Date(ts);
    if (Number.isNaN(date.getTime()))
        return null;
    const now = new Date();
    const sameDay = date.getFullYear() === now.getFullYear()
        && date.getMonth() === now.getMonth()
        && date.getDate() === now.getDate();
    const time = date.toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
    });
    if (sameDay)
        return time;
    const day = date.toLocaleDateString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
    });
    return `${day} ${time}`;
}
/** 步骤耗时展示：秒，保留两位小数 */
export function formatStepSeconds(ms) {
    if (ms === null)
        return null;
    return `${(Math.max(0, ms) / 1000).toFixed(2)}s`;
}
export function formatDuration(ms) {
    const sec = formatStepSeconds(ms);
    return sec ?? "0.00s";
}
/** 单条消息的耗时（ms），streaming 时用 now 作为结束时间 */
export function messageDuration(msg, now = Date.now()) {
    if (!msg.startedAt)
        return null;
    const end = msg.endedAt ?? (msg.isStreaming || (msg.startedAt && !msg.endedAt) ? now : null);
    if (end === null)
        return null;
    return Math.max(0, end - msg.startedAt);
}
/** 工具调用整段耗时：从 call 到 result 结束 */
export function toolStepDuration(call, result, now = Date.now()) {
    if (!call.startedAt)
        return null;
    const end = result?.endedAt
        ?? result?.startedAt
        ?? call.endedAt
        ?? ((call.isStreaming || result?.isStreaming) ? now : null);
    if (end === null)
        return null;
    return Math.max(0, end - call.startedAt);
}
export function isStepLive(...msgs) {
    return msgs.some((m) => m.isStreaming || (m.startedAt && !m.endedAt));
}
/** 执行过程分组步骤的耗时（ms） */
export function stepGroupDuration(group, now = Date.now()) {
    if (group.kind === "thinking" || group.kind === "text") {
        return group.msg ? messageDuration(group.msg, now) : null;
    }
    if (group.kind === "tool" && group.call) {
        return toolStepDuration(group.call, group.result, now);
    }
    return null;
}
