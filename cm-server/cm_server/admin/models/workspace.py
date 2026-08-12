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


class ChatUploadResponse(BaseModel):
    """会话附件上传结果：落盘到 session workspace，并同步入库 knowledge。"""

    filename: str
    relative_path: str = Field(description="相对目标目录的路径，如 report.pdf")
    stored_path: str = Field(description="落盘绝对路径")
    size: int
    doc_id: str = Field(description="knowledge / mRAG 返回的文档 ID")
    kb_id: str = Field(description="对话附件所在知识库 ID")
    knowledge_status: str = Field(
        default="uploaded",
        description="入库状态：uploaded / processing / indexed / failed",
    )
