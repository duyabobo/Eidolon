/**
 * 从本轮完整 assistant 文本中提取面向用户的最终答案。
 * 典型形态：
 *   Evidence is comprehensive...
 *   ## Step 7: Generate Answer
 *   <纯净答案>
 *
 * 匹配不到 Generate Answer 时返回 null，由调用方回退到最后一段 assistant 全文。
 */
const GENERATE_ANSWER_RE =
  /(?:^|\n)\s*(?:#{1,6}\s*)?(?:\*{1,2})?(?:Step|步骤)\s*\d+\s*[:：]\s*(?:Generate\s+Answer|生成答案)(?:\*{1,2})?\s*\r?\n+([\s\S]+)$/i;

export function extractFinalAnswer(fullText: string): string | null {
  const trimmed = fullText.trim();
  if (!trimmed) return null;

  const matched = trimmed.match(GENERATE_ANSWER_RE);
  if (matched?.[1]?.trim()) {
    return matched[1].trim();
  }

  return null;
}

/**
 * 本轮结束时应推送给前端的最终回复：
 * 优先 Generate Answer 段落，否则用最后一条 assistant 文本（保证一定有 final_result）。
 */
export function resolveFinalResultContent(
  lastAssistantText: string,
  turnTextBuffer: string,
): string | null {
  const last = lastAssistantText.trim();
  const buffer = turnTextBuffer.trim();
  const preferred = last || buffer;
  if (!preferred) return null;

  return (
    extractFinalAnswer(last) ||
    extractFinalAnswer(buffer) ||
    preferred
  );
}

/** 从 pi agent_end.messages 中取最后一条 assistant 文本 */
export function extractLastAssistantText(messages: unknown[] | undefined): string {
  if (!Array.isArray(messages) || messages.length === 0) return "";

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const text = assistantMessageText(messages[i]);
    if (text.trim()) return text;
  }
  return "";
}

function assistantMessageText(msg: unknown): string {
  if (!msg || typeof msg !== "object") return "";
  const message = msg as { role?: string; content?: unknown };
  if (message.role && message.role !== "assistant") return "";

  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((block) => {
      if (typeof block === "string") return block;
      if (!block || typeof block !== "object") return "";
      const item = block as { type?: string; text?: string };
      if (item.type === "text" || item.text != null) return String(item.text ?? "");
      return "";
    })
    .join("");
}
