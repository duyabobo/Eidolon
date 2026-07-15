import logging
import time

from fastapi import APIRouter, File, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse

from models.workspace import ChatUploadResponse, WorkspaceListResponse, WorkspaceMkdirRequest
from services import mongo_client
from services.chat_document_service import upload_chat_document_to_knowledge
from services.workspace_fs import (
    WorkspaceError,
    delete_entry,
    list_directory,
    mkdir,
    open_download,
    save_session_workspace_upload,
    save_upload,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/config/workspace", tags=["workspace"])


def _require_user_id(user_id: str) -> str:
    uid = user_id.strip()
    if not uid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="请先在「历史」页设置用户 ID",
        )
    return uid


def _http_exc(exc: WorkspaceError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=exc.message)


@router.get("/ls", response_model=WorkspaceListResponse)
async def workspace_ls(
    user_id: str = Query(..., description="用户 ID"),
    path: str = Query("", description="相对用户根的路径"),
) -> WorkspaceListResponse:
    uid = _require_user_id(user_id)
    try:
        session_meta = None
        norm = (path or "").strip().strip("/")
        if norm == "sessions":
            session_meta = await mongo_client.list_user_session_meta(uid)
        raw = list_directory(uid, path, session_meta=session_meta)
        return WorkspaceListResponse(**raw)
    except WorkspaceError as exc:
        raise _http_exc(exc) from exc


@router.post("/mkdir", response_model=WorkspaceListResponse)
async def workspace_mkdir(
    body: WorkspaceMkdirRequest,
    user_id: str = Query(..., description="用户 ID"),
) -> WorkspaceListResponse:
    uid = _require_user_id(user_id)
    try:
        created = mkdir(uid, body.path)
        parent = created.rsplit("/", 1)[0] if "/" in created else ""
        raw = list_directory(uid, parent)
        return WorkspaceListResponse(**raw)
    except WorkspaceError as exc:
        raise _http_exc(exc) from exc


@router.post("/upload", response_model=WorkspaceListResponse)
async def workspace_upload(
    user_id: str = Query(..., description="用户 ID"),
    path: str = Query(..., description="上传目标目录（相对用户根，须在 files/ 下）"),
    file: UploadFile = File(...),
) -> WorkspaceListResponse:
    uid = _require_user_id(user_id)
    data = await file.read()
    filename = file.filename or "upload.bin"
    try:
        save_upload(uid, path, filename, data)
        raw = list_directory(uid, path)
        return WorkspaceListResponse(**raw)
    except WorkspaceError as exc:
        raise _http_exc(exc) from exc


@router.delete("/entry", status_code=status.HTTP_204_NO_CONTENT)
async def workspace_delete(
    user_id: str = Query(..., description="用户 ID"),
    path: str = Query(..., description="要删除的相对路径（须在 files/ 下）"),
) -> None:
    uid = _require_user_id(user_id)
    try:
        delete_entry(uid, path)
    except WorkspaceError as exc:
        raise _http_exc(exc) from exc


@router.get("/download")
async def workspace_download(
    user_id: str = Query(..., description="用户 ID"),
    path: str = Query(..., description="要下载的文件相对路径"),
) -> FileResponse:
    uid = _require_user_id(user_id)
    try:
        abs_path, filename = open_download(uid, path)
        return FileResponse(path=abs_path, filename=filename)
    except WorkspaceError as exc:
        raise _http_exc(exc) from exc


@router.post(
    "/sessions/{session_id}/upload",
    response_model=ChatUploadResponse,
    summary="首页会话附件上传（写入 session workspace + knowledge 入库）",
)
async def session_workspace_upload(
    session_id: str,
    user_id: str = Query(..., description="用户 ID"),
    file: UploadFile = File(...),
) -> ChatUploadResponse:
    uid = _require_user_id(user_id)
    owner = await mongo_client.get_chat_session_owner(session_id)
    if owner is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="会话不存在")
    if owner != uid:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权访问该会话")

    data = await file.read()
    filename = file.filename or "upload.bin"
    content_type = file.content_type

    # 先走 knowledge（远程 mRAG / 本地库），拿到 doc_id 后再落盘，避免半成功状态
    knowledge = await upload_chat_document_to_knowledge(
        user_id=uid,
        filename=filename,
        content=data,
        content_type=content_type,
    )

    try:
        result = save_session_workspace_upload(uid, session_id, filename, data)
    except WorkspaceError as exc:
        raise _http_exc(exc) from exc

    event = {
        "event_type": "user_file",
        "content": result["filename"],
        "filename": result["filename"],
        "relative_path": result["relative_path"],
        "size": result["size"],
        "doc_id": knowledge.doc_id,
        "kb_id": knowledge.kb_id,
        "knowledge_status": knowledge.status,
        "ts": int(time.time() * 1000),
    }
    await mongo_client.append_chat_session_event(session_id, event)
    logger.info(
        "会话附件已入库 session=%s user=%s doc_id=%s kb_id=%s file=%s",
        session_id, uid, knowledge.doc_id, knowledge.kb_id, result["filename"],
    )
    return ChatUploadResponse(
        filename=result["filename"],
        relative_path=result["relative_path"],
        stored_path=result["stored_path"],
        size=result["size"],
        doc_id=knowledge.doc_id,
        kb_id=knowledge.kb_id,
        knowledge_status=knowledge.status,
    )

