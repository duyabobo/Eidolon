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
1. 只输出一个 JSON 对象，或 exactly 单词 SKIP（全大写）。禁止 markdown 代码块、禁止解释、禁止其它文字。
2. JSON 字段 name, description, content, tags（数组）, mcp_servers（数组）均为可选。
3. 只输出本轮用户要求「实际发生变化」的字段；未提及、不需要修改的字段（尤其是长篇的 content）请直接省略，
   平台会自动沿用现有草稿中的原值。例如用户只要求改 description，就只输出 {"description": "..."}。
   这样可以避免每次都要重新转义整段正文导致 JSON 语法出错。
4. 只有当用户明确要求修改正文时才输出 content：必须是完整可用正文（不含 YAML frontmatter，不要只输出 diff 片段），
   字符串内的换行、引号必须正确转义。
5. name 使用小写英文与连字符。
6. 仅当用户明显在闲聊、与 Skill 能力/正文完全无关，且当前无草稿时，输出 SKIP。
7. 用户明确要求修改某个字段时，必须在 JSON 中包含该字段的新值，禁止 SKIP。"""


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
        "请只输出本轮实际变化的字段组成的 JSON（未变化字段直接省略），或 SKIP。"
    )


async def _self_correct_retry(
    prompt: str,
    bad_reply: str,
    error: str,
    current_draft: SkillDraft | None,
) -> tuple[SkillDraft | None, str | None]:
    """把上一次的错误原因反馈给模型，请它只重新输出修正后的 JSON。"""
    retry_raw = await chat_completion(
        _DRAFT_SYNC_SYSTEM,
        [
            {"role": "user", "content": prompt},
            {"role": "assistant", "content": bad_reply},
            {
                "role": "user",
                "content": (
                    f"你上一次的输出不是合法 JSON（错误：{error}）。"
                    "请只重新输出修正后的合法 JSON 对象本身，不要加 markdown 代码块标记，不要包含任何解释文字。"
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
