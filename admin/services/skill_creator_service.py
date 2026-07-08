import logging
from datetime import datetime

from models.config import SkillMeta
from models.skill_creator import (
    CreateSessionResponse,
    PublishSkillRequest,
    SendMessageResponse,
    SkillCreatorMessage,
    SkillDraft,
)
from services import mongo_client, skill_creator_store
from services.skill_creator_llm import chat_completion
from services.skill_creator_parser import extract_skill_draft, strip_skill_draft_blocks
from services.skill_creator_prompt import load_system_prompt
from services.skills_fs import write_skill

logger = logging.getLogger(__name__)

_WELCOME_USER_PROMPT = (
    "管理员刚打开 Skill 创建助手。请用简短友好的语气欢迎，"
    "说明你会通过对话帮助创建 Skill，并询问他们想创建什么能力/场景。"
)


async def start_session() -> CreateSessionResponse:
    session = await skill_creator_store.create_session()
    system_prompt = load_system_prompt()
    raw_reply = await chat_completion(
        system_prompt,
        [{"role": "user", "content": _WELCOME_USER_PROMPT}],
    )
    draft = extract_skill_draft(raw_reply)
    display = strip_skill_draft_blocks(raw_reply)
    assistant = SkillCreatorMessage(role="assistant", content=display, created_at=datetime.utcnow())
    await skill_creator_store.set_initial_message(session.id, assistant, draft)

    return CreateSessionResponse(session_id=session.id, message=assistant)


async def get_session(session_id: str):
    return await skill_creator_store.get_session(session_id)


def _to_llm_messages(session_messages: list[SkillCreatorMessage]) -> list[dict[str, str]]:
    return [{"role": m.role, "content": m.content} for m in session_messages if m.content.strip()]


async def send_user_message(session_id: str, content: str) -> SendMessageResponse:
    session = await skill_creator_store.get_session(session_id)
    if session is None:
        raise LookupError("会话不存在")

    user_message = SkillCreatorMessage(role="user", content=content, created_at=datetime.utcnow())
    llm_messages = _to_llm_messages(session.messages) + [{"role": "user", "content": content}]

    raw_reply = await chat_completion(load_system_prompt(), llm_messages)
    draft = extract_skill_draft(raw_reply) or session.draft
    display = strip_skill_draft_blocks(raw_reply)
    assistant_message = SkillCreatorMessage(role="assistant", content=display, created_at=datetime.utcnow())

    await skill_creator_store.append_messages(session_id, user_message, assistant_message, draft)
    return SendMessageResponse(message=assistant_message, draft=draft)


def _merge_draft(session_draft: SkillDraft | None, body: PublishSkillRequest) -> SkillDraft:
    if session_draft is None and not body.name:
        raise ValueError("尚无 Skill 草稿，请继续对话或手动填写名称与内容")
    base = session_draft or SkillDraft(name="", description="", content="", tags=[])
    return SkillDraft(
        name=(body.name or base.name).strip(),
        description=(body.description or base.description).strip(),
        content=(body.content or base.content).strip(),
        tags=body.tags if body.tags is not None else base.tags,
    )


async def publish_session(session_id: str, body: PublishSkillRequest) -> SkillMeta:
    session = await skill_creator_store.get_session(session_id)
    if session is None:
        raise LookupError("会话不存在")

    draft = _merge_draft(session.draft, body)
    if not draft.name:
        raise ValueError("Skill 名称不能为空")
    if not draft.description:
        raise ValueError("Skill 描述不能为空")
    if not draft.content:
        raise ValueError("Skill 正文不能为空")

    write_skill(draft.name, draft.description, draft.content)
    meta = SkillMeta(
        name=draft.name,
        description=draft.description,
        tags=draft.tags,
        hidden=body.hidden,
    )
    saved = await mongo_client.save_skill_meta(meta)
    logger.info("skill-creator 已发布 skill: %s (session=%s)", draft.name, session_id)
    return saved
