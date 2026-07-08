const TYPE_COLORS = {
    concept: "#6366f1",
    method: "#0ea5e9",
    entity: "#10b981",
    default: "#94a3b8",
};
export function nodeColor(type) {
    return TYPE_COLORS[type.toLowerCase()] ?? TYPE_COLORS.default;
}
export function layoutGraph(nodes, edges, width, height) {
    if (nodes.length === 0)
        return [];
    const simNodes = nodes.map((n, i) => {
        const angle = (2 * Math.PI * i) / nodes.length;
        const r = Math.min(width, height) * 0.28;
        return {
            ...n,
            x: width / 2 + Math.cos(angle) * r,
            y: height / 2 + Math.sin(angle) * r,
            vx: 0,
            vy: 0,
        };
    });
    const idIndex = new Map(simNodes.map((n, i) => [n.node_id, i]));
    const simEdges = edges
        .map((e) => ({ s: idIndex.get(e.source_id), t: idIndex.get(e.target_id) }))
        .filter((e) => e.s !== undefined && e.t !== undefined);
    const iterations = Math.min(200, 80 + simNodes.length);
    for (let step = 0; step < iterations; step += 1) {
        for (let i = 0; i < simNodes.length; i += 1) {
            for (let j = i + 1; j < simNodes.length; j += 1) {
                const a = simNodes[i];
                const b = simNodes[j];
                let dx = a.x - b.x;
                let dy = a.y - b.y;
                let dist = Math.hypot(dx, dy) || 1;
                const force = 1200 / (dist * dist);
                dx = (dx / dist) * force;
                dy = (dy / dist) * force;
                a.vx += dx;
                a.vy += dy;
                b.vx -= dx;
                b.vy -= dy;
            }
        }
        for (const edge of simEdges) {
            const a = simNodes[edge.s];
            const b = simNodes[edge.t];
            let dx = b.x - a.x;
            let dy = b.y - a.y;
            const dist = Math.hypot(dx, dy) || 1;
            const force = (dist - 90) * 0.04;
            dx = (dx / dist) * force;
            dy = (dy / dist) * force;
            a.vx += dx;
            a.vy += dy;
            b.vx -= dx;
            b.vy -= dy;
        }
        for (const n of simNodes) {
            n.vx += (width / 2 - n.x) * 0.002;
            n.vy += (height / 2 - n.y) * 0.002;
            n.vx *= 0.85;
            n.vy *= 0.85;
            n.x += n.vx;
            n.y += n.vy;
            n.x = Math.max(40, Math.min(width - 40, n.x));
            n.y = Math.max(40, Math.min(height - 40, n.y));
        }
    }
    return simNodes;
}
export function truncateLabel(text, max = 18) {
    if (text.length <= max)
        return text;
    return `${text.slice(0, max - 1)}…`;
}
