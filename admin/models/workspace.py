from datetime import datetime

from pydantic import BaseModel, Field


class WorkspaceEntry(BaseModel):
    name: str
    display_name: str
    path: str
    is_dir: bool
    size: int = 0
    mtime: datetime | None = None
    readonly: bool = True


class WorkspaceListResponse(BaseModel):
    path: str
    writable: bool
    entries: list[WorkspaceEntry]


class WorkspaceMkdirRequest(BaseModel):
    path: str = Field(..., min_length=1, description="相对用户根的新目录路径，须在 files/ 下")
