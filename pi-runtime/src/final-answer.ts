/**
 * 从本轮完整 assistant 文本中提取面向用户的最终答案。
 * 典型形态：
 *   Evidence is comprehensive...
 *   Step 7: Generate Answer
 *   <纯净答案>
 *
 * 未匹配到 Generate Answer 步骤时返回 null（前端继续用最后一段 token 作为回复）。
 */
const GENERATE_ANSWER_RE =
  /(?:^|\n)\s*(?:Step|步骤)\s*\d+\s*[:：]\s*(?:Generate\s+Answer|生成答案)\s*\r?\n+([\s\S]+)$/i;

export function extractFinalAnswer(fullText: string): string | null {
  const trimmed = fullText.trim();
  if (!trimmed) return null;

  const matched = trimmed.match(GENERATE_ANSWER_RE);
  if (matched?.[1]?.trim()) {
    return matched[1].trim();
  }

  return null;
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
