from typing import Annotated

from fastapi import Header, HTTPException, status

from constants.knowledge import KNOWLEDGE_KEY_HEADER, SCENE_UID_HEADER


def require_knowledge_key(
    x_knowledge_key: Annotated[str | None, Header(alias=KNOWLEDGE_KEY_HEADER)] = None,
) -> str:
    key = (x_knowledge_key or "").strip()
    if not key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="缺少 X-Knowledge-Key 请求头，请先获取 knowledge_key",
        )
    return key


def require_scene_uid(
    x_scene_uid: Annotated[str | None, Header(alias=SCENE_UID_HEADER)] = None,
) -> str:
    uid = (x_scene_uid or "").strip()
    if not uid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="缺少 X-Scene-Uid 请求头，请先在「历史」页设置用户 ID",
        )
    return uid
