import { useMemo, useRef, useEffect, useCallback, useState } from "react";
import { APP_LOGO, APP_NAME } from "../../constants/brand";
import type { Message } from "../../context/ChatSessionContext";
import { formatFileSize } from "../../utils/formatFileSize";
import FilePreviewModal, { type FilePreviewSource } from "../FilePreviewModal";
import TruncatedFilename from "../TruncatedFilename";
import { ConfigActionBtn } from "../config/ConfigActionBtn";
import DocumentWikiModal, { knowledgeDocFromUpload } from "../knowledge/DocumentWikiModal";
import type { KnowledgeDocument } from "../../api/knowledge";
import ChatMarkdown from "./ChatMarkdown";
import ExecutionSteps from "./ExecutionSteps";
import { formatMessageTime } from "./stepTiming";

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
  | { kind: "user_file"; filename: string; relativePath?: string; size?: number; docId?: string; kbId?: string; startedAt?: number }
  | { kind: "assistant"; turn: AssistantTurn };

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
          kbId: msg.kbId,
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
  const className = [
    "rounded-2.5xl px-3.5 py-2.5 text-sm bg-white border border-ink-200/70 text-ink-800 shadow-soft inline-flex items-center gap-2.5 max-w-[min(100%,20rem)] text-left",
    align === "right" ? "rounded-br-md" : "rounded-bl-md",
    clickable ? "hover:border-brand-300 hover:bg-brand-50/40 cursor-pointer transition-colors" : "",
    busy ? "opacity-70 cursor-wait" : "",
  ].filter(Boolean).join(" ");

  const body = (
    <>
      <span className="w-8 h-8 rounded-lg bg-ink-100 text-ink-500 flex items-center justify-center text-[10px] font-semibold shrink-0">
        FILE
      </span>
      <span className="min-w-0 flex-1">
        {busy ? (
          <span className="block font-medium truncate">打开中…</span>
        ) : (
          <TruncatedFilename name={filename} className="font-medium text-sm" />
        )}
        {subtitle && (
          <span className="block text-[11px] text-ink-400 mt-0.5 truncate">{subtitle}</span>
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
const TOUCH_SCROLL_UP_SLOP_PX = 2;

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
  const contentRef = useRef<HTMLDivElement>(null);
  /** 仅由用户滚动意图更新；内容增高时不要用几何位置重算，否则会误判脱离底部 */
  const pinnedToBottomRef = useRef(true);
  const lastScrollTopRef = useRef(0);
  const touchStartYRef = useRef<number | null>(null);
  const [preview, setPreview] = useState<FilePreviewSource | null>(null);
  const [wikiDoc, setWikiDoc] = useState<KnowledgeDocument | null>(null);

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

  const stickToBottomIfPinned = useCallback(() => {
    const container = scrollRef.current;
    if (!container || !pinnedToBottomRef.current) return;
    scrollToBottom(container, "auto");
  }, []);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    lastScrollTopRef.current = container.scrollTop;

    // 离开底部 → 取消贴底；回到底部仅在非上滑时恢复，避免小幅上拉被阈值内 scroll 抢回
    const onScroll = () => {
      const scrollTop = container.scrollTop;
      const scrollingUp = scrollTop < lastScrollTopRef.current;
      const atBottom = isPinnedToBottom(container);
      lastScrollTopRef.current = scrollTop;

      if (!atBottom) {
        pinnedToBottomRef.current = false;
        return;
      }
      if (!scrollingUp) {
        pinnedToBottomRef.current = true;
      }
    };

    // 上滑意图立刻取消贴底（即使仍在阈值内），避免与流式跟底抢滚动
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) {
        pinnedToBottomRef.current = false;
      }
    };

    const onTouchStart = () => {
      touchStartYRef.current = null;
    };

    const onTouchMove = (event: TouchEvent) => {
      const touchY = event.touches[0]?.clientY;
      if (touchY == null) return;
      if (touchStartYRef.current == null) {
        touchStartYRef.current = touchY;
        return;
      }
      // 手指下移 → 内容上拉
      if (touchY > touchStartYRef.current + TOUCH_SCROLL_UP_SLOP_PX) {
        pinnedToBottomRef.current = false;
      }
    };

    container.addEventListener("scroll", onScroll, { passive: true });
    container.addEventListener("wheel", onWheel, { passive: true });
    container.addEventListener("touchstart", onTouchStart, { passive: true });
    container.addEventListener("touchmove", onTouchMove, { passive: true });
    return () => {
      container.removeEventListener("scroll", onScroll);
      container.removeEventListener("wheel", onWheel);
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);
    };
  }, []);

  // 内容区高度变化（流式 token / markdown 重排 / 步骤展开）时，贴底则持续跟底
  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;

    const observer = new ResizeObserver(() => {
      stickToBottomIfPinned();
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [stickToBottomIfPinned]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const last = messages[messages.length - 1];
    if (last?.role === "user") {
      pinnedToBottomRef.current = true;
      scrollToBottom(container, "smooth");
      return;
    }

    stickToBottomIfPinned();
  }, [messages, stickToBottomIfPinned]);

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-thin">
      <div ref={contentRef} className="page-content py-6 space-y-5">
        {messages.length === 0 && (
          <div className="text-center mt-24 px-4">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-brand-500 to-violet-600 flex items-center justify-center text-white text-lg font-bold shadow-soft mb-4">
              {APP_LOGO}
            </div>
            <p className="text-ink-700 font-medium">开始与 {APP_NAME} 对话</p>
            <p className="text-sm text-ink-400 mt-2 leading-relaxed">
              哎，懂了
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
                  <div className="flex items-center justify-end gap-1.5">
                    {item.docId && item.kbId && (
                      <ConfigActionBtn
                        variant="violet"
                        title="查看 Wiki 图谱"
                        onClick={() =>
                          setWikiDoc(
                            knowledgeDocFromUpload({
                              docId: item.docId as string,
                              kbId: item.kbId as string,
                              name: item.filename,
                              fileSize: item.size,
                            }),
                          )
                        }
                      >
                        图谱
                      </ConfigActionBtn>
                    )}
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
      {wikiDoc && (
        <DocumentWikiModal
          kbId={wikiDoc.kb_id}
          doc={wikiDoc}
          onClose={() => setWikiDoc(null)}
        />
      )}
    </div>
  );
}
