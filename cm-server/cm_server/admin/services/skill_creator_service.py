import logging
from cm_server.admin.models.config import SkillMeta
from cm_server.admin.models.skill_creator import (
    PublishSkillRequest,
    SendMessageResponse,
    SkillCreatorMessage,
    SkillCreatorSession,
    SkillDraft,
)
from pi_shared import now_china
from cm_server.admin.services import skill_creator_store
from cm_server.admin.services.skill_creator_llm import chat_completion
from cm_server.admin.services.skill_creator_mcp import (
    enrich_draft_with_mcp_reference,
    fetch_mcp_tools,
    prepare_mcp_context_for_message,
    resolve_mcp_server_names,
    list_configured_mcp_names,
)
from cm_server.admin.services.skill_creator_draft_sync import sync_skill_draft
from cm_server.admin.services.skill_creator_parser import extract_skill_draft, strip_skill_draft_blocks
from cm_server.admin.services.skill_creator_prompt import load_system_prompt
from cm_server.admin.services import skill_meta_store
from cm_server.admin.services.skills_fs import write_skill, write_user_skill

logger = logging.getLogger(__name__)

_WELCOME_SYSTEM = (
    "你好！我是 Skill 创建助手，可以帮你通过对话生成系统级 Skill。\n"
    "请告诉我你想创建什么能力或场景的 Skill。\n"
    "若需要调用外部工具，请一并说明依赖的 MCP Server 名称（须与 Admin 中已配置的名称一致）、用途，"
    "以及期望用到的能力；平台会按工具名白名单注入，Skill 正文只需写业务流程。"
)
_WELCOME_USER = (
    "你好！我是 Skill 创建助手，可以帮你通过对话生成私有 Skill。\n"
    "请告诉我你想创建什么能力或场景的 Skill。\n"
    "若需要调用外部工具，请一并说明依赖的 MCP Server 名称（须与 Admin 中已配置的名称一致）、用途，"
    "以及期望用到的能力；平台会按工具名白名单注入，Skill 正文只需写业务流程。"
)


async def start_session(
    user_id: str | None = None,
    force_new: bool = False,
    skill_name: str | None = None,
) -> SkillCreatorSession:
    """获取或创建 skill-creator 会话。

    优先级：
    1. skill_name 指定：加载该 Skill 对应的会话（编辑已保存 Skill）
    2. force_new=True：强制新建（放弃当前草稿，开始全新会话）
    3. 默认：复用最近的未发布草稿；若无则新建

    欢迎语使用静态文本，不调用 LLM，保证即开即用。
    """
    if skill_name:
        existing = await skill_creator_store.get_session_by_skill_name(user_id, skill_name)
        if existing:
            logger.info("复用 skill-creator 会话（编辑模式）: %s skill=%s", existing.id, skill_name)
            return existing
        # 该 Skill 没有对应会话（旧数据），新建一个并预填 skill_name 以便后续关联
        logger.info("未找到 skill=%s 的会话，新建", skill_name)

    elif not force_new:
        unpublished = await skill_creator_store.get_latest_unpublished_session(user_id)
        if unpublished:
            logger.info("复用未发布 skill-creator 会话: %s user_id=%s", unpublished.id, user_id)
            return unpublished

    session = await skill_creator_store.create_session(user_id)
    welcome_text = _WELCOME_USER if user_id else _WELCOME_SYSTEM
    welcome = SkillCreatorMessage(role="assistant", content=welcome_text, created_at=now_china())
    await skill_creator_store.set_initial_message(session.id, welcome, None)
    session.messages = [welcome]
    logger.info(
        "skill-creator 新会话已创建: %s user_id=%s force_new=%s skill_name=%s",
        session.id, user_id, force_new, skill_name,
    )
    return session


async def get_session(session_id: str):
    return await skill_creator_store.get_session(session_id)


async def reset_session(session_id: str) -> SkillCreatorSession:
    """清空未发布会话的历史，重置为初始欢迎语。已发布的会话不允许重置。"""
    session = await skill_creator_store.get_session(session_id)
    if session is None:
        raise LookupError("会话不存在")
    if session.published:
        raise ValueError("已发布的 Skill 会话不能重置")

    await skill_creator_store.reset_messages(session_id)
    welcome_text = _WELCOME_USER if session.user_id else _WELCOME_SYSTEM
    welcome = SkillCreatorMessage(role="assistant", content=welcome_text, created_at=now_china())
    await skill_creator_store.set_initial_message(session_id, welcome, None)
    session.messages = [welcome]
    session.draft = None
    logger.info("skill-creator 会话已重置: %s user_id=%s", session_id, session.user_id)
    return session


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
    server_names = resolve_mcp_server_names(user_message, history_text, configured)
    if not server_names:
        # 无 MCP 依赖时仍剥离旧 boilerplate，避免历史草稿残留
        return enrich_draft_with_mcp_reference(draft, [])

    infos = await fetch_mcp_tools(user_id, server_names)
    return enrich_draft_with_mcp_reference(draft, infos)


async def send_user_message(session_id: str, content: str) -> SendMessageResponse:
    session = await skill_creator_store.get_session(session_id)
    if session is None:
        raise LookupError("会话不存在")

    user_message = SkillCreatorMessage(role="user", content=content, created_at=now_china())
    llm_messages = _to_llm_messages(session.messages) + [{"role": "user", "content": content}]
    history_text = _history_text(session.messages)

    mcp_context, _ = await prepare_mcp_context_for_message(
        session.user_id,
        content,
        history_text,
    )
    system_prompt = load_system_prompt() + mcp_context

    raw_reply = await chat_completion(system_prompt, llm_messages, tag="chat")
    extracted = extract_skill_draft(raw_reply, base=session.draft)

    # 已有草稿（含编辑已保存 Skill）：每轮强制同步，不依赖对话回复里是否带 JSON 块
    if session.draft is not None:
        draft = await sync_skill_draft(
            session.messages,
            session.draft,
            content,
            raw_reply,
        )
    elif extracted:
        draft = extracted
        logger.info("skill-creator session=%s: 从对话回复解析到草稿 name=%s", session_id, extracted.name)
    else:
        draft = await sync_skill_draft(
            session.messages,
            session.draft,
            content,
            raw_reply,
        )
    draft = await _finalize_draft_with_mcp(session.user_id, draft, content, history_text)
    display = strip_skill_draft_blocks(raw_reply)
    assistant_message = SkillCreatorMessage(role="assistant", content=display, created_at=now_china())

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
        mcp_tools=base.mcp_tools,
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

    user_id = session.user_id
    if user_id:
        write_user_skill(
            user_id,
            draft.name,
            draft.description,
            draft.content,
            mcp_tools=draft.mcp_tools,
        )
    else:
        write_skill(
            draft.name,
            draft.description,
            draft.content,
            mcp_tools=draft.mcp_tools,
        )

    meta = SkillMeta(
        name=draft.name,
        description=draft.description,
        user_id=user_id,
        tags=draft.tags,
        mcp_tools=draft.mcp_tools,
        hidden=body.hidden if not user_id else False,
    )
    saved = await skill_meta_store.save_skill_meta(meta)
    await skill_creator_store.mark_published(session_id, draft.name)
    logger.info(
        "skill-creator 已发布 skill: %s user_id=%s session=%s",
        draft.name,
        user_id,
        session_id,
    )
    return saved
