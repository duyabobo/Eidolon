import logging
import mimetypes

from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import FileResponse, PlainTextResponse

from cm_server.admin.models.plugin_creator import (
    PluginCreatorSession,
    PluginSendMessageRequest,
    PluginSendMessageResponse,
    PublishPluginRequest,
)
from cm_server.admin.services import plugin_creator_service
from cm_server.admin.services.plugins_fs import list_creator_tree, open_creator_file
from cm_server.shared.machine_uid import owner_id_for_scope

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/config/plugins/creator", tags=["plugin-creator"])

_TEXT_PREVIEW_MAX_BYTES = 2 * 1024 * 1024


@router.post("/sessions", response_model=PluginCreatorSession)
async def create_session(
    scope: str | None = Query(None),
    force_new: bool = Query(False),
    plugin_name: str | None = Query(None),
) -> PluginCreatorSession:
    uid = await owner_id_for_scope(scope)
    try:
        return await plugin_creator_service.start_session(
            uid, force_new=force_new, plugin_name=(plugin_name or "").strip() or None,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get("/sessions/{session_id}", response_model=PluginCreatorSession)
async def get_session(session_id: str) -> PluginCreatorSession:
    session = await plugin_creator_service.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="会话不存在")
    return session


@router.post("/sessions/{session_id}/messages", response_model=PluginSendMessageResponse)
async def send_message(session_id: str, body: PluginSendMessageRequest) -> PluginSendMessageResponse:
    content = body.content.strip()
    if not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="消息不能为空")
    try:
        return await plugin_creator_service.send_user_message(session_id, content)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except RuntimeError as exc:
        logger.exception("plugin-creator 对话失败 session=%s", session_id)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.post("/sessions/{session_id}/reset", response_model=PluginCreatorSession)
async def reset_session(session_id: str) -> PluginCreatorSession:
    try:
        return await plugin_creator_service.reset_session(session_id)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/sessions/{session_id}/publish")
async def publish_plugin(session_id: str, body: PublishPluginRequest) -> dict:
    try:
        return await plugin_creator_service.publish_session(session_id, body)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get("/sessions/{session_id}/tree")
async def session_plugin_tree(session_id: str) -> dict:
    session = await plugin_creator_service.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="会话不存在")
    plugin_creator_service.ensure_draft_on_disk(session)
    draft_name = session.draft.name if session.draft else None
    return list_creator_tree(
        user_id=session.user_id,
        session_id=session.id,
        plugin_name=session.plugin_name,
        draft_name=draft_name,
    )


@router.get("/sessions/{session_id}/file")
async def session_plugin_file(
    session_id: str,
    path: str = Query(...),
    disposition: str = Query(default="inline"),
    as_text: bool = Query(default=False),
):
    session = await plugin_creator_service.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="会话不存在")
    draft_name = session.draft.name if session.draft else None
    opened = open_creator_file(
        user_id=session.user_id,
        session_id=session.id,
        plugin_name=session.plugin_name,
        draft_name=draft_name,
        rel_path=path,
    )
    if opened is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="文件不存在")
    abs_path, filename = opened
    disp = (disposition or "inline").strip().lower()
    if disp not in {"inline", "attachment"}:
        disp = "inline"
    if as_text:
        if abs_path.stat().st_size > _TEXT_PREVIEW_MAX_BYTES:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="文件过大，无法文本预览")
        return PlainTextResponse(abs_path.read_text(encoding="utf-8", errors="replace"))
    media_type, _ = mimetypes.guess_type(filename)
    return FileResponse(
        path=abs_path,
        filename=filename if disp == "attachment" else None,
        media_type=media_type,
        content_disposition_type=disp,
    )
