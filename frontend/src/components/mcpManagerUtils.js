import { mcpServerStatusKey } from "./McpServerUi";
export function buildStatusMap(servers) {
    const next = {};
    for (const item of servers) {
        next[mcpServerStatusKey(item.scope, item.name)] = item;
    }
    return next;
}
export function mergeStatus(prev, item) {
    return { ...prev, [mcpServerStatusKey(item.scope, item.name)]: item };
}
export function serverStatusKey(server) {
    return mcpServerStatusKey(server.scope, server.name);
}
