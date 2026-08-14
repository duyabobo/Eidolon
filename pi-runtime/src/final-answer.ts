/**
 * 把 pi agent_end 的最后一条 assistant 文本投影为前端 final_result。
 * 不做 SOP/段落裁剪——答案形态交给 skill 与模型，平台不二次加工 harness 输出。
 */

/** 本轮结束推送给前端的最终回复：优先 messages 末条 assistant，否则 text_delta 缓冲。 */
export function resolveFinalResultContent(
  lastAssistantText: string,
  turnTextBuffer: string,
): string | null {
  const preferred = lastAssistantText.trim() || turnTextBuffer.trim();
  return preferred || null;
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
