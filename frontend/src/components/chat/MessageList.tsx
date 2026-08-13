import { useMemo, useRef, useEffect, useCallback, useState } from "react";
import { APP_LOGO, APP_NAME } from "../../constants/brand";
import type { Message } from "../../context/ChatSessionContext";
import FilePreviewModal, { type FilePreviewSource } from "../FilePreviewModal";
import ChatMarkdown from "./ChatMarkdown";
import ExecutionSteps from "./ExecutionSteps";
import { formatMessageTime } from "./stepTiming";
import { canPreviewFile } from "../../utils/filePreview";

interface AssistantAttachment {
  filename: string;
  relativePath?: string;
  size?: number;
}

interface AssistantTurn {
  steps: Message[];
  finalText: Message | null;
  attachments: AssistantAttachment[];
  startedAt?: number;
}

type DisplayItem =
  | { kind: "user"; content: string; startedAt?: number }
  | { kind: "user_file"; filename: string; relativePath?: string; size?: number; docId?: string; startedAt?: number }
  | { kind: "assistant"; turn: AssistantTurn };

function formatFileSize(bytes?: number): string {
  if (bytes == null || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function resolveTurnStartedAt(msgs: Message[]): number | undefined {
  for (const msg of msgs) {
    if (msg.startedAt != null) return msg.startedAt;
  }
  return undefined;
}

/** download API 需要 users/{uid}/ 下的相对路径 */
function resolveWorkspaceDownloadPath(
  sessionId: string | null | undefined,
  relativePath: string | undefined,
  filename: string,
): string | null {
  const path = (relativePath || filename || "").trim();
  if (!path) return null;
  if (path.startsWith("sessions/")) return path;
  if (!sessionId) return null;
  return `sessions/${sessionId}/workspace/${path}`;
}

function toAttachment(msg: Message): AssistantAttachment {
  return {
    filename: msg.content,
    relativePath: msg.relativePath,
    size: msg.size,
  };
}

function groupMessages(messages: Message[]): DisplayItem[] {
  const items: DisplayItem[] = [];
  let i = 0;

  while (i < messages.length) {
    const msg = messages[i];
    if (msg.role === "user") {
      if (msg.type === "file") {
        items.push({
          kind: "user_file",
          filename: msg.content,
          relativePath: msg.relativePath,
          size: msg.size,
          docId: msg.docId,
          startedAt: msg.startedAt,
        });
      } else {
        items.push({ kind: "user", content: msg.content, startedAt: msg.startedAt });
      }
      i += 1;
      continue;
    }

    const assistantMsgs: Message[] = [];
    while (i < messages.length && messages[i].role === "assistant") {
      assistantMsgs.push(messages[i]);
      i += 1;
    }

    const attachments = assistantMsgs.filter((m) => m.type === "file").map(toAttachment);
    const nonFileMsgs = assistantMsgs.filter((m) => m.type !== "file");

    let finalResultIdx = -1;
    let lastTextIdx = -1;
    for (let j = nonFileMsgs.length - 1; j >= 0; j -= 1) {
      if (finalResultIdx < 0 && nonFileMsgs[j].type === "final_result") {
        finalResultIdx = j;
      }
      if (lastTextIdx < 0 && nonFileMsgs[j].type === "text") {
        lastTextIdx = j;
      }
    }

    const startedAt = resolveTurnStartedAt(assistantMsgs);

    // 有 final_result：此前所有生成内容（含 Step7 叙述）都进中间步骤，最终只展示纯净答案
    if (finalResultIdx >= 0) {
      items.push({
        kind: "assistant",
        turn: {
          steps: nonFileMsgs.filter((_, idx) => idx !== finalResultIdx),
          finalText: nonFileMsgs[finalResultIdx],
          attachments,
          startedAt,
        },
      });
      continue;
    }

    // 流式进行中：token 一律折叠进中间步骤，不把中间生成当最终回复
    const streaming = nonFileMsgs.some((m) => m.isStreaming);
    if (streaming) {
      items.push({
        kind: "assistant",
        turn: { steps: nonFileMsgs, finalText: null, attachments, startedAt },
      });
      continue;
    }

    // 历史兼容：旧会话无 final_result 时，仍用最后一段 text 作为回复
    const steps = lastTextIdx >= 0 ? nonFileMsgs.slice(0, lastTextIdx) : nonFileMsgs;
    const finalText = lastTextIdx >= 0 ? nonFileMsgs[lastTextIdx] : null;
    items.push({
      kind: "assistant",
      turn: { steps, finalText, attachments, startedAt },
    });
  }

  return items;
}

function MessageTime({ ts, align }: { ts?: number; align: "left" | "right" }) {
  const label = formatMessageTime(ts);
  if (!label) return null;
  return (
    <p className={`text-[10px] text-ink-400 mt-1 tabular-nums ${align === "right" ? "text-right" : "text-left"}`}>
      {label}
    </p>
  );
}

function EidolonAvatar() {
  return (
    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-brand-500 to-violet-600 flex items-center justify-center text-white text-[10px] font-semibold shrink-0 mt-0.5 shadow-sm">
      {APP_LOGO}
    </div>
  );
}

function FileChip({
  filename,
  subtitle,
  title,
  onOpen,
  busy,
  align,
}: {
  filename: string;
  subtitle?: string;
  title?: string;
  onOpen?: () => void;
  busy?: boolean;
  align: "left" | "right";
}) {
  const clickable = Boolean(onOpen) && !busy;
  const previewHint = canPreviewFile(filename) ? "点击预览" : "点击打开";
  const className = [
    "rounded-2.5xl px-3.5 py-2.5 text-sm bg-white border border-ink-200/70 text-ink-800 shadow-soft inline-flex items-center gap-2.5 max-w-full text-left",
    align === "right" ? "rounded-br-md" : "rounded-bl-md",
    clickable ? "hover:border-brand-300 hover:bg-brand-50/40 cursor-pointer transition-colors" : "",
    busy ? "opacity-70 cursor-wait" : "",
  ].filter(Boolean).join(" ");

  const body = (
    <>
      <span className="w-8 h-8 rounded-lg bg-ink-100 text-ink-500 flex items-center justify-center text-[10px] font-semibold shrink-0">
        FILE
      </span>
      <span className="min-w-0">
        <span className="block font-medium truncate">
          {busy ? "打开中…" : filename}
        </span>
        {subtitle && (
          <span className="block text-[11px] text-ink-400 mt-0.5">{subtitle}</span>
        )}
        {clickable && (
          <span className="block text-[11px] text-brand-600 mt-0.5">{previewHint}</span>
        )}
      </span>
    </>
  );

  if (clickable) {
    return (
      <button type="button" onClick={onOpen} className={className} title={title || filename}>
        {body}
      </button>
    );
  }

  return (
    <div className={className} title={title || filename}>
      {body}
    </div>
  );
}

function AssistantTurnBlock({
  turn,
  userId,
  sessionId,
  onPreview,
}: {
  turn: AssistantTurn;
  userId: string;
  sessionId: string | null;
  onPreview: (source: FilePreviewSource) => void;
}) {
  const { steps, finalText, attachments, startedAt } = turn;
  const hasSteps = steps.length > 0;
  const onlySteps = hasSteps && !finalText;

  const openAttachment = useCallback((file: AssistantAttachment) => {
    const path = resolveWorkspaceDownloadPath(sessionId, file.relativePath, file.filename);
    if (!userId.trim() || !path) return;
    onPreview({
      type: "workspace",
      userId: userId.trim(),
      path,
      filename: file.filename,
    });
  }, [userId, sessionId, onPreview]);

  return (
    <div className="flex gap-3 justify-start">
      <EidolonAvatar />
      <div className="flex-1 min-w-0">
        <MessageTime ts={startedAt} align="left" />
        {hasSteps && <ExecutionSteps steps={steps} />}
        {finalText && (
          <div className="max-w-[92%]">
            {hasSteps && (
              <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-400 mb-1.5 pl-0.5">
                回复
              </p>
            )}
            <div className="rounded-2.5xl rounded-bl-md px-4 py-3 text-sm leading-relaxed break-words bg-white border border-ink-200/60 text-ink-900 shadow-soft">
              <ChatMarkdown
                content={finalText.content}
                streaming={finalText.isStreaming}
              />
            </div>
            {attachments.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {attachments.map((file) => {
                  const path = resolveWorkspaceDownloadPath(sessionId, file.relativePath, file.filename);
                  const sizeLabel = formatFileSize(file.size);
                  return (
                    <FileChip
                      key={path || file.filename}
                      filename={file.filename}
                      subtitle={sizeLabel || undefined}
                      title={file.relativePath || file.filename}
                      onOpen={path ? () => openAttachment(file) : undefined}
                      align="left"
                    />
                  );
                })}
              </div>
            )}
          </div>
        )}
        {!finalText && attachments.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {attachments.map((file) => {
              const path = resolveWorkspaceDownloadPath(sessionId, file.relativePath, file.filename);
              const sizeLabel = formatFileSize(file.size);
              return (
                <FileChip
                  key={path || file.filename}
                  filename={file.filename}
                  subtitle={sizeLabel || undefined}
                  title={file.relativePath || file.filename}
                  onOpen={path ? () => openAttachment(file) : undefined}
                  align="left"
                />
              );
            })}
          </div>
        )}
        {onlySteps && (
          <p className="text-xs text-ink-400 mt-2 pl-1 flex items-center gap-1.5">
            <span className="w-1 h-1 rounded-full bg-ink-300 animate-pulse" />
            正在生成，完成后将展示最终回复…
          </p>
        )}
      </div>
    </div>
  );
}

interface Props {
  messages: Message[];
  userId: string;
  sessionId: string | null;
}

const SCROLL_PIN_THRESHOLD_PX = 80;

function isPinnedToBottom(container: HTMLElement): boolean {
  const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
  return distance <= SCROLL_PIN_THRESHOLD_PX;
}

function scrollToBottom(container: HTMLElement, behavior: ScrollBehavior) {
  container.scrollTo({ top: container.scrollHeight, behavior });
}

export default function MessageList({ messages, userId, sessionId }: Props) {
  const displayItems = useMemo(() => groupMessages(messages), [messages]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedToBottomRef = useRef(true);
  const [preview, setPreview] = useState<FilePreviewSource | null>(null);

  const openUserFile = useCallback((
    filename: string,
    relativePath?: string,
  ) => {
    const path = resolveWorkspaceDownloadPath(sessionId, relativePath, filename);
    if (!userId.trim() || !path) return;
    setPreview({
      type: "workspace",
      userId: userId.trim(),
      path,
      filename,
    });
  }, [userId, sessionId]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const onScroll = () => {
      const pinned = isPinnedToBottom(container);
      const wasPinned = pinnedToBottomRef.current;
      pinnedToBottomRef.current = pinned;
      if (pinned && !wasPinned) {
        scrollToBottom(container, "auto");
      }
    };

    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const last = messages[messages.length - 1];
    const userJustSent = last?.role === "user";

    if (userJustSent) {
      pinnedToBottomRef.current = true;
      scrollToBottom(container, "smooth");
      return;
    }

    const pinned = isPinnedToBottom(container);
    pinnedToBottomRef.current = pinned;
    if (pinned) {
      scrollToBottom(container, "auto");
    }
  }, [messages]);

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-thin">
      <div className="page-content py-6 space-y-5">
        {messages.length === 0 && (
          <div className="text-center mt-24 px-4">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-brand-500 to-violet-600 flex items-center justify-center text-white text-lg font-bold shadow-soft mb-4">
              {APP_LOGO}
            </div>
            <p className="text-ink-700 font-medium">开始与 {APP_NAME} 对话</p>
            <p className="text-sm text-ink-400 mt-2 leading-relaxed">
              输入 / 可选择 Skill，Enter 发送
            </p>
          </div>
        )}
        {displayItems.map((item, i) => {
          if (item.kind === "user") {
            return (
              <div key={i} className="flex justify-end">
                <div className="max-w-[78%]">
                  <MessageTime ts={item.startedAt} align="right" />
                  <div className="rounded-2.5xl rounded-br-md px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words bg-gradient-to-br from-brand-600 to-brand-700 text-white shadow-soft">
                    {item.content}
                  </div>
                </div>
              </div>
            );
          }
          if (item.kind === "user_file") {
            const sizeLabel = formatFileSize(item.size);
            const subtitle = [sizeLabel, item.docId ? `doc:${item.docId.slice(0, 8)}…` : ""]
              .filter(Boolean)
              .join(" · ");
            const path = resolveWorkspaceDownloadPath(sessionId, item.relativePath, item.filename);
            return (
              <div key={i} className="flex justify-end">
                <div className="max-w-[78%]">
                  <MessageTime ts={item.startedAt} align="right" />
                  <FileChip
                    filename={item.filename}
                    subtitle={subtitle || undefined}
                    title={
                      item.docId
                        ? `${item.relativePath || item.filename}\ndoc_id: ${item.docId}`
                        : (item.relativePath || item.filename)
                    }
                    onOpen={path ? () => openUserFile(item.filename, item.relativePath) : undefined}
                    align="right"
                  />
                </div>
              </div>
            );
          }
          return (
            <AssistantTurnBlock
              key={i}
              turn={item.turn}
              userId={userId}
              sessionId={sessionId}
              onPreview={setPreview}
            />
          );
        })}
      </div>

      {preview && (
        <FilePreviewModal
          source={preview}
          subtitle={preview.path}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}
