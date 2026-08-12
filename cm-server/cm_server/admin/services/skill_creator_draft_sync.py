"""
Skill 草稿同步：对话与写草稿分离。

输出格式为完整 SKILL.md（YAML frontmatter + Markdown 正文），
避免把长正文塞进 JSON 字符串导致转义失败、右侧草稿空白。
"""
import logging

from cm_server.admin.models.skill_creator import SkillCreatorMessage, SkillDraft
from cm_server.admin.services.skill_creator_llm import chat_completion
from cm_server.admin.services.skill_creator_parser import build_skill_markdown, parse_draft_text

logger = logging.getLogger(__name__)

_DRAFT_SYNC_SYSTEM = """你是 Skill 草稿同步器。平台会把你的输出直接写入右侧「草稿预览」，用户看不到本段输出。

任务：根据完整对话、当前草稿与用户最新指令，生成或更新 Skill 草稿。

输出规则（必须遵守）：
1. 只输出下面两种之一，禁止解释、禁止其它文字：
   A) 单词 SKIP（全大写）
   B) 一份完整的 SKILL.md 原文，格式固定为：

---
name: skill-name
description: 一句话说明何时使用
mcp_tools:
  - tool-a
  - tool-b
---

这里是 Markdown 正文（原始文本，换行与引号都不用转义）。
不要写「MCP 工具使用 / MCP 工具参考」，不要写 mcp-proxy 探测说明，不要写 mcp_servers 或任何业务 Server 名。

2. name 使用小写英文与连字符；description 必须有；正文必须是完整可用内容（不含第二段 frontmatter）。
3. mcp_tools 为运行时工具名白名单（依赖 MCP 时必填，只写具体工具名，不写 Server 名）；tags 可选。
4. 仅当用户明显在闲聊、与 Skill 完全无关，且当前无草稿时，输出 SKIP。
5. 用户确认定稿、修改需求、或对话里已具备足够信息生成 Skill 时，禁止 SKIP，必须输出完整 SKILL.md。
6. 可以外层包一层 ```md ... ```，但不要输出 JSON。"""


def _build_sync_user_prompt(
    messages: list[SkillCreatorMessage],
    current_draft: SkillDraft | None,
    user_message: str,
    assistant_reply: str,
) -> str:
    history_lines: list[str] = []
    for item in messages:
        role = "用户" if item.role == "user" else "助手"
        history_lines.append(f"[{role}] {item.content.strip()}")

    history = "\n\n".join(history_lines)
    current = build_skill_markdown(current_draft) if current_draft else "（尚无草稿）"
    return (
        f"## 当前草稿（SKILL.md）\n{current}\n\n"
        f"## 对话历史\n{history}\n\n"
        f"## 用户最新消息\n{user_message.strip()}\n\n"
        f"## 助手刚回复（理解修改意图，草稿以对话与当前草稿为准）\n{assistant_reply.strip()}\n\n"
        "请输出完整更新后的 SKILL.md，或 SKIP。"
    )


async def _self_correct_retry(
    prompt: str,
    bad_reply: str,
    error: str,
    current_draft: SkillDraft | None,
) -> tuple[SkillDraft | None, str | None]:
    retry_raw = await chat_completion(
        _DRAFT_SYNC_SYSTEM,
        [
            {"role": "user", "content": prompt},
            {"role": "assistant", "content": bad_reply},
            {
                "role": "user",
                "content": (
                    f"你上一次的输出无法解析（错误：{error}）。"
                    "请重新输出完整 SKILL.md：以 --- frontmatter --- 开头，后接 Markdown 正文；"
                    "不要 JSON，不要解释。"
                ),
            },
        ],
        temperature=0.1,
        tag="draft-sync-retry",
    )
    if retry_raw.strip().upper() == "SKIP":
        return current_draft, None
    return parse_draft_text(retry_raw, base=current_draft)


async def sync_skill_draft(
    messages: list[SkillCreatorMessage],
    current_draft: SkillDraft | None,
    user_message: str,
    assistant_reply: str,
) -> SkillDraft | None:
    """
    单独一轮 LLM 调用，把对话意图同步到结构化草稿。
    返回 None 表示保持无草稿；返回 SkillDraft 表示最新草稿（可能与 current 相同）。
    """
    prompt = _build_sync_user_prompt(messages, current_draft, user_message, assistant_reply)
    raw = await chat_completion(
        _DRAFT_SYNC_SYSTEM,
        [{"role": "user", "content": prompt}],
        temperature=0.1,
        tag="draft-sync",
    )

    if raw.strip().upper() == "SKIP":
        logger.info("skill-creator draft-sync: SKIP，保持现有草稿")
        return current_draft

    draft, error = parse_draft_text(raw, base=current_draft)
    if draft is None:
        logger.warning(
            "skill-creator draft-sync: 首次解析失败，自我修正重试一次 error=%s reply_len=%d",
            error, len(raw),
        )
        draft, retry_error = await _self_correct_retry(prompt, raw, error or "未知错误", current_draft)
        if draft is None:
            logger.error(
                "skill-creator draft-sync: 重试后仍解析失败，保持现有草稿 error=%s reply_preview=%r",
                retry_error or error, raw[:200],
            )
            return current_draft

    if current_draft and draft.model_dump() == current_draft.model_dump():
        logger.info("skill-creator draft-sync: 草稿未变化 name=%s", draft.name)
    else:
        logger.info(
            "skill-creator draft-sync: 草稿已更新 name=%s content_len=%d",
            draft.name,
            len(draft.content),
        )
    return draft
