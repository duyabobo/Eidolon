import logging

from cm_server.admin.models.plugin_creator import (
    PluginCreatorMessage,
    PluginCreatorSession,
    PluginDraft,
    PluginSendMessageResponse,
    PublishPluginRequest,
)
from cm_server.admin.services import plugin_creator_store
from cm_server.admin.services.skill_creator_llm import chat_completion
from cm_server.admin.services.plugin_creator_parser import extract_plugin_draft, strip_plugin_draft_blocks
from cm_server.admin.services.plugin_creator_prompt import load_plugin_system_prompt
from cm_server.admin.services.plugin_register import register_local_plugin
from cm_server.admin.services.plugins_fs import read_plugin, sync_plugin_draft_to_disk, write_plugin
from pi_shared import now_china

logger = logging.getLogger(__name__)

_WELCOME = (
    "你好！我是插件创建助手。\n"
    "插件会安装到本机客户端，保存后自动登记到 mcp-proxy，给 Agent 调用。\n"
    "请告诉我你想让这个插件在本机替你做什么。"
)
_WELCOME_EDIT = (
    "这是已安装到本机的插件。告诉我要改什么能力，我会改代码；"
    "保存后会重新登记到 mcp-proxy。"
)


def _draft_from_disk(plugin_name: str, user_id: str | None) -> PluginDraft | None:
    loaded = read_plugin(plugin_name, user_id)
    if loaded is None:
        return None
    description, server_py = loaded
    return PluginDraft(name=plugin_name, description=description, server_py=server_py)


async def _attach_installed_draft(
    session: PluginCreatorSession,
    plugin_name: str,
) -> PluginCreatorSession:
    draft = session.draft or _draft_from_disk(plugin_name, session.user_id)
    if draft is None:
        return session
    await plugin_creator_store.set_plugin_draft(session.id, plugin_name, draft)
    session.plugin_name = plugin_name
    session.draft = draft
    _persist_draft(session, draft)
    return session


def _persist_draft(session: PluginCreatorSession, draft: PluginDraft | None) -> None:
    if draft is None or not draft.name.strip():
        return
    sync_plugin_draft_to_disk(
        user_id=session.user_id,
        session_id=session.id,
        plugin_name=session.plugin_name,
        draft_name=draft.name,
        name=draft.name,
        description=draft.description,
        server_py=draft.server_py,
    )


def ensure_draft_on_disk(session: PluginCreatorSession) -> None:
    _persist_draft(session, session.draft)


async def start_session(
    user_id: str | None = None,
    force_new: bool = False,
    plugin_name: str | None = None,
) -> PluginCreatorSession:
    if plugin_name:
        existing = await plugin_creator_store.get_session_by_plugin_name(user_id, plugin_name)
        if existing:
            return await _attach_installed_draft(existing, plugin_name)
    elif not force_new:
        unpublished = await plugin_creator_store.get_latest_unpublished_session(user_id)
        if unpublished:
            return unpublished

    session = await plugin_creator_store.create_session(user_id)
    welcome_text = _WELCOME_EDIT if plugin_name else _WELCOME
    welcome = PluginCreatorMessage(role="assistant", content=welcome_text, created_at=now_china())
    await plugin_creator_store.set_initial_message(session.id, welcome)
    session.messages = [welcome]
    if plugin_name:
        session = await _attach_installed_draft(session, plugin_name)
    logger.info("plugin-creator 新会话 id=%s user=%s plugin=%s", session.id, user_id, plugin_name or "-")
    return session


async def get_session(session_id: str) -> PluginCreatorSession | None:
    return await plugin_creator_store.get_session(session_id)


async def reset_session(session_id: str) -> PluginCreatorSession:
    session = await plugin_creator_store.get_session(session_id)
    if session is None:
        raise LookupError("会话不存在")
    if session.published:
        raise ValueError("已发布的插件会话不能重置")
    await plugin_creator_store.reset_messages(session_id)
    welcome = PluginCreatorMessage(role="assistant", content=_WELCOME, created_at=now_china())
    await plugin_creator_store.set_initial_message(session_id, welcome)
    session.messages = [welcome]
    session.draft = None
    return session


def _to_llm_messages(messages: list[PluginCreatorMessage]) -> list[dict[str, str]]:
    return [{"role": m.role, "content": m.content} for m in messages if m.content.strip()]


async def send_user_message(session_id: str, content: str) -> PluginSendMessageResponse:
    session = await plugin_creator_store.get_session(session_id)
    if session is None:
        raise LookupError("会话不存在")

    user_message = PluginCreatorMessage(role="user", content=content, created_at=now_china())
    llm_messages = _to_llm_messages(session.messages) + [{"role": "user", "content": content}]
    raw_reply = await chat_completion(load_plugin_system_prompt(), llm_messages, tag="plugin")
    draft = extract_plugin_draft(raw_reply, base=session.draft)
    display = strip_plugin_draft_blocks(raw_reply)
    assistant_message = PluginCreatorMessage(role="assistant", content=display, created_at=now_china())
    await plugin_creator_store.append_messages(session_id, user_message, assistant_message, draft)
    _persist_draft(session, draft)
    return PluginSendMessageResponse(message=assistant_message, draft=draft)


def _merge_draft(session_draft: PluginDraft | None, body: PublishPluginRequest) -> PluginDraft:
    if session_draft is None and not body.name:
        raise ValueError("尚无插件草稿，请继续对话完善后再保存")
    base = session_draft or PluginDraft(name="", description="", server_py="")
    return PluginDraft(
        name=(body.name or base.name).strip(),
        description=(body.description or base.description).strip(),
        server_py=(body.server_py or base.server_py).strip(),
    )


async def publish_session(session_id: str, body: PublishPluginRequest) -> dict:
    session = await plugin_creator_store.get_session(session_id)
    if session is None:
        raise LookupError("会话不存在")
    draft = _merge_draft(session.draft, body)
    if not draft.name:
        raise ValueError("插件名称不能为空")
    if not draft.description:
        raise ValueError("插件描述不能为空")
    if not draft.server_py:
        raise ValueError("插件代码不能为空")

    write_plugin(draft.name, draft.description, draft.server_py, session.user_id)
    await register_local_plugin(
        name=draft.name,
        description=draft.description,
        user_id=session.user_id,
    )
    await plugin_creator_store.mark_published(session_id, draft.name)
    logger.info("plugin-creator 已发布 name=%s user=%s", draft.name, session.user_id)
    return {
        "name": draft.name,
        "description": draft.description,
        "user_id": session.user_id,
    }
