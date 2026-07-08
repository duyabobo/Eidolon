from typing import Annotated

from fastapi import Header, HTTPException, status

from constants.knowledge import KNOWLEDGE_KEY_HEADER


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
