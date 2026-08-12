"""内部 API：仅供 pi-runtime 调用，实时推送轮次增量事件（替代原 Redis XADD）。"""
import logging

from fastapi import APIRouter, status
from pydantic import BaseModel

from cm_server.gateway_sse.services import event_store

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/internal", tags=["internal"])


class PublishEventRequest(BaseModel):
    session_id: str
    turn_id: str
    event_type: str
    content: str = ""


@router.post("/events", status_code=status.HTTP_204_NO_CONTENT)
async def publish_event(body: PublishEventRequest) -> None:
    await event_store.publish_event(body.session_id, body.turn_id, body.event_type, body.content)
