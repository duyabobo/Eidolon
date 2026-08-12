import logging
from typing import Any

import httpx

from cm_server.admin.config import settings

logger = logging.getLogger(__name__)

_LLM_CHAT_PATH = "/v1/chat/completions"
_DEFAULT_TIMEOUT = 180.0


async def chat_completion(
    system_prompt: str,
    messages: list[dict[str, str]],
    *,
    temperature: float = 0.4,
    tag: str = "chat",
) -> str:
    """调用 llm-proxy 完成一轮对话，返回 assistant 文本。"""
    url = settings.llm_proxy_base_url.rstrip("/") + _LLM_CHAT_PATH
    payload: dict[str, Any] = {
        "model": "default",
        "messages": [{"role": "system", "content": system_prompt}, *messages],
        "temperature": temperature,
    }

    async with httpx.AsyncClient(timeout=_DEFAULT_TIMEOUT) as client:
        response = await client.post(url, json=payload)
        response.raise_for_status()
        data = response.json()

    choices = data.get("choices") or []
    if not choices:
        raise RuntimeError("LLM 返回为空")
    content = choices[0].get("message", {}).get("content", "")
    if not content:
        raise RuntimeError("LLM 未返回文本内容")
    logger.info("skill-creator LLM [%s] 回复长度=%d", tag, len(content))
    return content
