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
            session_meta = await session_meta_store.list_user_session_meta(uid)
        raw = list_directory(uid, path, session_meta=session_meta)
        return WorkspaceListResponse.model_validate(raw)
    except WorkspaceError as exc:
        raise _http_exc(exc) from exc


@router.post("/mkdir", response_model=WorkspaceListResponse)
async def workspace_mkdir(
    body: WorkspaceMkdirRequest,
    user_id: str = Query(..., description="用户 ID"),
) -> WorkspaceListResponse:
    uid = _require_user_id(user_id)
    try:
        mkdir(uid, body.path)
        raw = list_directory(uid, body.path.rsplit("/", 1)[0] if "/" in body.path else "")
        return WorkspaceListResponse.model_validate(raw)
    except WorkspaceError as exc:
        raise _http_exc(exc) from exc


@router.post("/upload", response_model=WorkspaceListResponse)
async def workspace_upload(
    user_id: str = Query(..., description="用户 ID"),
    path: str = Query("", description="目标目录相对路径"),
    file: UploadFile = File(...),
) -> WorkspaceListResponse:
    uid = _require_user_id(user_id)
    data = await file.read()
    try:
        save_upload(uid, path, file.filename or "upload.bin", data)
        raw = list_directory(uid, path)
        return WorkspaceListResponse.model_validate(raw)
    except WorkspaceError as exc:
        raise _http_exc(exc) from exc


@router.delete("/entry", status_code=status.HTTP_204_NO_CONTENT)
async def workspace_delete(
    user_id: str = Query(..., description="用户 ID"),
    path: str = Query(..., description="要删除的相对路径"),
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
