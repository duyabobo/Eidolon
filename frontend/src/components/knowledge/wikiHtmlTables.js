/** 将 OCR 等产出的 HTML table 独立成 Markdown HTML 块，便于 rehype-raw 解析。 */
const HTML_TABLE_PATTERN = /<table\b[\s\S]*?<\/table>/gi;
export function isolateHtmlTables(content) {
    if (!content || !/<table\b/i.test(content)) {
        return content;
    }
    return content.replace(HTML_TABLE_PATTERN, (tableHtml) => `\n\n${tableHtml.trim()}\n\n`);
}
