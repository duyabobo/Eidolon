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
from services import skill_creator_store
from services.skill_creator_llm import chat_completion
from services.skill_creator_mcp import (
    enrich_draft_with_mcp_reference,
    fetch_mcp_tools,
    prepare_mcp_context_for_message,
    resolve_mcp_server_names,
    list_configured_mcp_names,
)
from services.skill_creator_parser import extract_skill_draft, strip_skill_draft_blocks
from services.skill_creator_prompt import load_system_prompt
from services import mongo_client
from services.skills_fs import write_skill, write_user_skill

logger = logging.getLogger(__name__)

_WELCOME_SYSTEM = (
    "管理员刚打开 Skill 创建助手。请用简短友好的语气欢迎，"
    "说明你会通过对话帮助创建系统级 Skill，并询问他们想创建什么能力/场景。"
)
_WELCOME_USER = (
    "用户刚打开 Skill 创建助手。请用简短友好的语气欢迎，"
    "说明你会通过对话帮助创建属于该用户的私有 Skill，并询问他们想创建什么能力/场景。"
)


async def start_session(user_id: str | None = None) -> CreateSessionResponse:
    session = await skill_creator_store.create_session(user_id)
    welcome = _WELCOME_USER if user_id else _WELCOME_SYSTEM
    raw_reply = await chat_completion(
        load_system_prompt(),
        [{"role": "user", "content": welcome}],
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


def _history_text(session_messages: list[SkillCreatorMessage]) -> str:
    return "\n".join(m.content for m in session_messages if m.content.strip())


async def _finalize_draft_with_mcp(
    user_id: str | None,
    draft: SkillDraft | None,
    user_message: str,
    history_text: str,
) -> SkillDraft | None:
    if draft is None:
        return None

    configured = await list_configured_mcp_names(user_id)
    server_names = resolve_mcp_server_names(user_message, draft, history_text, configured)
    if not server_names and draft.mcp_servers:
        server_names = draft.mcp_servers
    if not server_names:
        return draft

    infos = await fetch_mcp_tools(user_id, server_names)
    return enrich_draft_with_mcp_reference(draft, infos)


async def send_user_message(session_id: str, content: str) -> SendMessageResponse:
    session = await skill_creator_store.get_session(session_id)
    if session is None:
        raise LookupError("会话不存在")

    user_message = SkillCreatorMessage(role="user", content=content, created_at=datetime.utcnow())
    llm_messages = _to_llm_messages(session.messages) + [{"role": "user", "content": content}]
    history_text = _history_text(session.messages)

    mcp_context, _ = await prepare_mcp_context_for_message(
        session.user_id,
        content,
        session.draft,
        history_text,
    )
    system_prompt = load_system_prompt() + mcp_context

    raw_reply = await chat_completion(system_prompt, llm_messages)
    draft = extract_skill_draft(raw_reply) or session.draft
    draft = await _finalize_draft_with_mcp(session.user_id, draft, content, history_text)
    display = strip_skill_draft_blocks(raw_reply)
    assistant_message = SkillCreatorMessage(role="assistant", content=display, created_at=datetime.utcnow())

    await skill_creator_store.append_messages(session_id, user_message, assistant_message, draft)
    return SendMessageResponse(message=assistant_message, draft=draft)


def _merge_draft(session_draft: SkillDraft | None, body: PublishSkillRequest) -> SkillDraft:
    if session_draft is None and not body.name:
        raise ValueError("尚无 Skill 草稿，请继续对话完善后再保存")
    base = session_draft or SkillDraft(name="", description="", content="", tags=[])
    return SkillDraft(
        name=(body.name or base.name).strip(),
        description=(body.description or base.description).strip(),
        content=(body.content or base.content).strip(),
        tags=body.tags if body.tags is not None else base.tags,
        mcp_servers=base.mcp_servers,
        mcp_tools_reference=base.mcp_tools_reference,
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

    history_text = _history_text(session.messages)
    draft = await _finalize_draft_with_mcp(session.user_id, draft, "", history_text) or draft

    references: dict[str, str] | None = None
    if draft.mcp_tools_reference.strip():
        references = {"mcp-tools.md": draft.mcp_tools_reference.strip()}

    user_id = session.user_id
    if user_id:
        write_user_skill(user_id, draft.name, draft.description, draft.content, references)
    else:
        write_skill(draft.name, draft.description, draft.content, references)

    meta = SkillMeta(
        name=draft.name,
        description=draft.description,
        user_id=user_id,
        tags=draft.tags,
        hidden=body.hidden if not user_id else False,
    )
    saved = await mongo_client.save_skill_meta(meta)
    logger.info(
        "skill-creator 已发布 skill: %s user_id=%s session=%s",
        draft.name,
        user_id,
        session_id,
    )
    return saved
