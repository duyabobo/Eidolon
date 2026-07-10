/** 将 LLM 常输出的「多行表格挤在一行」还原为逐行表格 */
function expandCollapsedTableRows(content) {
    return content.replace(/\|\s+\|(?=\s*[-:]|\s*\S)/g, "|\n|");
}
/** 去掉表头/表尾多余空列（如「| 列A | 列B | |」） */
function trimTrailingEmptyTableColumns(content) {
    const lines = content.split("\n");
    const result = [];
    for (const line of lines) {
        const trimmed = line.trim();
        const isTableLine = trimmed.startsWith("|") && trimmed.includes("|", 1);
        if (!isTableLine) {
            result.push(line);
            continue;
        }
        const endsWithEmptyCell = /\|\s*\|\s*$/.test(trimmed);
        if (endsWithEmptyCell) {
            result.push(trimmed.replace(/\|\s*\|\s*$/, "|"));
            continue;
        }
        result.push(line);
    }
    return result.join("\n");
}
/** 对话 Markdown 预处理：修复表格等常见 LLM 输出格式问题 */
export function preprocessChatMarkdown(content) {
    if (!content.includes("|"))
        return content;
    let processed = expandCollapsedTableRows(content);
    processed = trimTrailingEmptyTableColumns(processed);
    return processed;
}
