"""OpenAI-compatible LLM / VLM 客户端（复用聊天活跃 llm_profile）。"""
from __future__ import annotations

import asyncio
import base64
import logging
import mimetypes
from pathlib import Path
from typing import Any

from openai import AsyncOpenAI

from cm_server.mrag.settings import MragRuntimeSettings

logger = logging.getLogger(__name__)


class LlmClient:
    def __init__(
        self,
        *,
        base_url: str,
        api_key: str,
        model: str,
        timeout: int,
        runtime: MragRuntimeSettings,
    ) -> None:
        self.model = model
        self.runtime = runtime
        self._sem = asyncio.Semaphore(max(1, runtime.llm_max_concurrent))
        self._vlm_sem = asyncio.Semaphore(max(1, runtime.vlm_max_concurrent))
        self._client = AsyncOpenAI(
            api_key=api_key or "EMPTY",
            base_url=base_url.rstrip("/"),
            timeout=timeout,
        )
        self._api_key = api_key or "EMPTY"
        self._timeout = timeout

    async def chat_text(
        self,
        prompt: str,
        *,
        system: str = "You are a helpful assistant.",
        temperature: float = 0.2,
    ) -> str:
        async with self._sem:
            logger.info("LLM 文本调用: model=%s chars=%s", self.model, len(prompt))
            resp = await self._client.chat.completions.create(
                model=self.model,
                temperature=temperature,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": prompt},
                ],
            )
        return (resp.choices[0].message.content or "").strip()

    async def chat_vision(
        self,
        prompt: str,
        image_path: Path,
        *,
        temperature: float = 0.2,
    ) -> str:
        if not self.runtime.vlm_enabled:
            return ""

        mime = mimetypes.guess_type(image_path.name)[0] or "image/png"
        b64 = base64.b64encode(image_path.read_bytes()).decode("ascii")
        data_url = f"data:{mime};base64,{b64}"
        vlm_base = self.runtime.mineru_vlm_url.rstrip("/")
        client = AsyncOpenAI(
            api_key=self._api_key,
            base_url=vlm_base,
            timeout=self._timeout,
        )
        async with self._vlm_sem:
            logger.info("VLM 调用: url=%s image=%s", vlm_base, image_path.name)
            resp = await client.chat.completions.create(
                model=self.model,
                temperature=temperature,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": prompt},
                            {"type": "image_url", "image_url": {"url": data_url}},
                        ],
                    }
                ],
            )
        return (resp.choices[0].message.content or "").strip()

    async def map_bounded(
        self,
        items: list[Any],
        worker,
        *,
        concurrency: int | None = None,
    ) -> list[Any]:
        limit = max(1, concurrency or self.runtime.llm_max_concurrent)
        sem = asyncio.Semaphore(limit)
        results: list[Any] = [None] * len(items)

        async def _run(index: int, item: Any) -> None:
            async with sem:
                results[index] = await worker(item)

        await asyncio.gather(*[_run(i, item) for i, item in enumerate(items)])
        return results


async def build_llm_client_from_active_profile(runtime: MragRuntimeSettings) -> LlmClient:
    from cm_server.llm_proxy.services import llm_profile_store

    profile = await llm_profile_store.get_active_llm_profile()
    if profile is None:
        raise RuntimeError("未配置聊天 LLM，请先在设置中添加并激活 LLM Profile")
    logger.info(
        "知识库 LLM 使用活跃 profile id=%s model=%s",
        profile.id,
        profile.model,
    )
    return LlmClient(
        base_url=profile.base_url,
        api_key=profile.api_key,
        model=profile.model,
        timeout=profile.timeout,
        runtime=runtime,
    )
