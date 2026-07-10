"""
Skill 草稿同步：对话与写草稿分离，避免模型「说了改但没输出 JSON」导致预览不更新。
"""
import json
import logging

from models.skill_creator import SkillCreatorMessage, SkillDraft
from services.skill_creator_llm import chat_completion
from services.skill_creator_parser import parse_draft_text

logger = logging.getLogger(__name__)

_DRAFT_SYNC_SYSTEM = """你是 Skill 草稿同步器。平台会把你的 JSON 输出直接写入右侧「草稿预览」，用户看不到本段输出。

任务：根据完整对话、当前草稿与用户最新指令，生成或更新 Skill 草稿。

输出规则（必须遵守）：
1. 只输出一个 JSON 对象，或 exactly 单词 SKIP（全大写）。禁止 markdown、禁止解释、禁止其它文字。
2. JSON 字段：name, description, content, tags（数组）, mcp_servers（数组，可选）。
3. content 为 SKILL.md 正文（不含 YAML frontmatter），必须是完整可用正文，不要只输出 diff 片段。
4. 若已有草稿，在现有基础上按用户最新要求修改；未提及的段落保持原样。
5. name 使用小写英文与连字符。
6. 仅当用户明显在闲聊、与 Skill 能力/正文完全无关，且当前无草稿时，输出 SKIP。
7. 用户要求修改 Skill、补充能力、调整正文时，必须输出完整 JSON，禁止 SKIP。"""


def _format_current_draft(draft: SkillDraft | None) -> str:
    if draft is None:
        return "（尚无草稿）"
    return json.dumps(draft.model_dump(), ensure_ascii=False, indent=2)


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
    return (
        f"## 当前草稿\n{_format_current_draft(current_draft)}\n\n"
        f"## 对话历史\n{history}\n\n"
        f"## 用户最新消息\n{user_message.strip()}\n\n"
        f"## 助手刚回复（理解修改意图，草稿以对话与当前草稿为准）\n{assistant_reply.strip()}\n\n"
        "请输出更新后的完整草稿 JSON，或 SKIP。"
    )


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

    parsed = parse_draft_text(raw, base=current_draft)
    if parsed is None:
        logger.warning(
            "skill-creator draft-sync: 解析失败 reply_len=%d preview=%r",
            len(raw),
            raw[:200],
        )
        return current_draft

    if current_draft and parsed.model_dump() == current_draft.model_dump():
        logger.info("skill-creator draft-sync: 草稿未变化 name=%s", parsed.name)
    else:
        logger.info(
            "skill-creator draft-sync: 草稿已更新 name=%s content_len=%d",
            parsed.name,
            len(parsed.content),
        )
    return parsed
