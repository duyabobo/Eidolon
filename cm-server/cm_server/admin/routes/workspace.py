import logging

from fastapi import APIRouter, File, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from pi_shared.workspace import WorkspaceError

from cm_server.admin.models.workspace import WorkspaceListResponse, WorkspaceMkdirRequest
from cm_server.admin.services import session_meta_store
from cm_server.admin.services.workspace_fs import (
    delete_entry,
    list_directory,
    mkdir,
    open_download,
    save_upload,
)
from cm_server.admin.services.workspace_knowledge import (
    attach_knowledge_to_listing,
    ingest_session_upload,
)
from cm_server.shared.machine_uid import current_user_id

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/config/workspace", tags=["workspace"])


def _http_exc(exc: WorkspaceError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=exc.message)


@router.get("/ls", response_model=WorkspaceListResponse)
async def workspace_ls(
    path: str = Query("", description="相对本机根的路径"),
) -> WorkspaceListResponse:
    uid = await current_user_id()
    try:
        session_meta = None
        norm = (path or "").strip().strip("/")
        if norm == "sessions":
            session_meta = await session_meta_store.list_user_session_meta(uid)
        raw = list_directory(uid, path, session_meta=session_meta)
        raw = await attach_knowledge_to_listing(uid, raw)
        return WorkspaceListResponse.model_validate(raw)
    except WorkspaceError as exc:
        raise _http_exc(exc) from exc


@router.post("/mkdir", response_model=WorkspaceListResponse)
async def workspace_mkdir(body: WorkspaceMkdirRequest) -> WorkspaceListResponse:
    uid = await current_user_id()
    try:
        mkdir(uid, body.path)
        raw = list_directory(uid, body.path.rsplit("/", 1)[0] if "/" in body.path else "")
        raw = await attach_knowledge_to_listing(uid, raw)
        return WorkspaceListResponse.model_validate(raw)
    except WorkspaceError as exc:
        raise _http_exc(exc) from exc


@router.post("/upload", response_model=WorkspaceListResponse)
async def workspace_upload(
    path: str = Query("", description="目标目录相对路径"),
    file: UploadFile = File(...),
) -> WorkspaceListResponse:
    uid = await current_user_id()
    data = await file.read()
    try:
        dest_rel = save_upload(uid, path, file.filename or "upload.bin", data)
        await ingest_session_upload(
            uid, dest_rel, file.filename or "upload.bin", data, file.content_type,
        )
        raw = list_directory(uid, path)
        raw = await attach_knowledge_to_listing(uid, raw)
        return WorkspaceListResponse.model_validate(raw)
    except WorkspaceError as exc:
        raise _http_exc(exc) from exc


@router.delete("/entry", status_code=status.HTTP_204_NO_CONTENT)
async def workspace_delete(
    path: str = Query(..., description="要删除的相对路径"),
) -> None:
    uid = await current_user_id()
    try:
        delete_entry(uid, path)
    except WorkspaceError as exc:
        raise _http_exc(exc) from exc


@router.get("/download")
async def workspace_download(
    path: str = Query(..., description="要下载的文件相对路径"),
    disposition: str = Query(
        default="attachment",
        description="attachment=下载；inline=预览（浏览器内联）",
    ),
) -> FileResponse:
    uid = await current_user_id()
    try:
        abs_path, filename = open_download(uid, path)
        disp = (disposition or "attachment").strip().lower()
        if disp not in {"attachment", "inline"}:
            disp = "attachment"
        return FileResponse(
            path=abs_path,
            filename=filename if disp == "attachment" else None,
            content_disposition_type=disp,
        )
    except WorkspaceError as exc:
        raise _http_exc(exc) from exc
