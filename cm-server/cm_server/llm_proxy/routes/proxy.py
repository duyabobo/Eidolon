import json
import logging
import time
import uuid
from collections.abc import AsyncIterator
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import JSONResponse, StreamingResponse

from cm_server.llm_proxy.services import llm_record_store
from cm_server.llm_proxy.services.llm_config_store import get_effective_config
from cm_server.llm_proxy.services.output_parser import assemble_stream_output, extract_text_from_openai_response
from cm_server.llm_proxy.services.request_context import extract_request_context

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1", tags=["llm-proxy"])

HEADER_LLM_ID = "X-Llm-Id"


def _apply_model(body: dict[str, Any]) -> dict[str, Any]:
    body["model"] = get_effective_config().model
    return body


def _openai_upstream_url(path: str) -> str:
    cfg = get_effective_config()
    return f"{cfg.base_url.rstrip('/')}{path}"


def _openai_headers() -> dict[str, str]:
    cfg = get_effective_config()
    return {
        "Authorization": f"Bearer {cfg.api_key}",
        "Content-Type": "application/json",
    }


async def _finalize_success(llm_id: str, output: str, start: float) -> None:
    latency_ms = int((time.perf_counter() - start) * 1000)
    await llm_record_store.finalize_record(
        llm_id, output=output, status="completed", latency_ms=latency_ms,
    )


async def _finalize_error(llm_id: str, error: str, start: float, partial_output: str = "") -> None:
    latency_ms = int((time.perf_counter() - start) * 1000)
    await llm_record_store.finalize_record(
        llm_id,
        output=partial_output,
        status="error",
        error=error,
        latency_ms=latency_ms,
    )


async def _openai_stream(
    url: str,
    headers: dict,
    body: dict,
    timeout: int,
    llm_id: str,
    start: float,
) -> StreamingResponse:
    client = httpx.AsyncClient(timeout=timeout)
    collected: list[bytes] = []

    async def generator() -> AsyncIterator[bytes]:
        try:
            async with client.stream("POST", url, headers=headers, json=body) as resp:
                if resp.status_code != 200:
                    err = await resp.aread()
                    err_text = err.decode("utf-8", errors="replace")[:500]
                    logger.error("OpenAI 上游流式错误: %d %s", resp.status_code, err_text[:200])
                    await _finalize_error(llm_id, f"上游返回 {resp.status_code}: {err_text}", start)
                    yield f"data: {json.dumps({'error': resp.status_code})}\n\n".encode()
                    return
                async for chunk in resp.aiter_bytes():
                    collected.append(chunk)
                    yield chunk
            output = assemble_stream_output(b"".join(collected))
            await _finalize_success(llm_id, output, start)
        except Exception as exc:
            logger.exception("OpenAI 流式代理异常: llm_id=%s", llm_id)
            partial = assemble_stream_output(b"".join(collected))
            await _finalize_error(llm_id, str(exc), start, partial_output=partial)
            raise
        finally:
            await client.aclose()

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            HEADER_LLM_ID: llm_id,
        },
    )


async def _openai_normal(
    url: str,
    headers: dict,
    body: dict,
    timeout: int,
    llm_id: str | None = None,
    start: float | None = None,
) -> dict:
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(url, headers=headers, json=body)
    if resp.status_code != 200:
        err_text = resp.text[:500]
        logger.error("OpenAI 上游错误: %d %s", resp.status_code, err_text[:200])
        if llm_id is not None and start is not None:
            await _finalize_error(llm_id, f"上游返回 {resp.status_code}: {err_text}", start)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY,
                            detail=f"LLM 上游返回 {resp.status_code}")
    data = resp.json()
    if llm_id is not None and start is not None:
        output = extract_text_from_openai_response(data)
        await _finalize_success(llm_id, output, start)
    return data


_ANTHROPIC_VERSION = "2023-06-01"
_ANTHROPIC_DEFAULT_MAX_TOKENS = 4096


def _anthropic_upstream_url() -> str:
    cfg = get_effective_config()
    return f"{cfg.base_url.rstrip('/')}/v1/messages"


def _anthropic_headers() -> dict[str, str]:
    cfg = get_effective_config()
    return {
        "x-api-key": cfg.api_key,
        "anthropic-version": _ANTHROPIC_VERSION,
        "Content-Type": "application/json",
    }


def _to_anthropic_request(openai_body: dict[str, Any]) -> dict[str, Any]:
    messages = openai_body.get("messages", [])
    system_parts = [m["content"] for m in messages if m.get("role") == "system"]
    non_system = [m for m in messages if m.get("role") != "system"]

    body: dict[str, Any] = {
        "model": openai_body.get("model", get_effective_config().model),
        "messages": [{"role": m["role"], "content": m["content"]} for m in non_system],
        "max_tokens": openai_body.get("max_tokens") or _ANTHROPIC_DEFAULT_MAX_TOKENS,
    }
    if system_parts:
        body["system"] = "\n\n".join(system_parts)
    if openai_body.get("temperature") is not None:
        body["temperature"] = openai_body["temperature"]
    if openai_body.get("stream"):
        body["stream"] = True
    return body


def _from_anthropic_response(ant_resp: dict[str, Any]) -> dict[str, Any]:
    text = "".join(
        block.get("text", "")
        for block in ant_resp.get("content", [])
        if block.get("type") == "text"
    )
    stop_reason = ant_resp.get("stop_reason", "end_turn")
    finish_reason = "stop" if stop_reason in ("end_turn", "max_tokens") else stop_reason
    usage = ant_resp.get("usage", {})

    return {
        "id": ant_resp.get("id", f"chatcmpl-{uuid.uuid4().hex}"),
        "object": "chat.completion",
        "created": int(time.time()),
        "model": ant_resp.get("model", get_effective_config().model),
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": text},
                "finish_reason": finish_reason,
            }
        ],
        "usage": {
            "prompt_tokens": usage.get("input_tokens", 0),
            "completion_tokens": usage.get("output_tokens", 0),
            "total_tokens": usage.get("input_tokens", 0) + usage.get("output_tokens", 0),
        },
    }


def _anthropic_sse_to_openai(line: str) -> str | None:
    if not line.startswith("data:"):
        return None
    raw = line[5:].strip()
    if not raw or raw == "[DONE]":
        return None

    try:
        evt = json.loads(raw)
    except json.JSONDecodeError:
        return None

    evt_type = evt.get("type")

    if evt_type == "content_block_delta":
        delta = evt.get("delta", {})
        if delta.get("type") == "text_delta":
            text = delta.get("text", "")
            openai_chunk = {
                "id": f"chatcmpl-{uuid.uuid4().hex}",
                "object": "chat.completion.chunk",
                "created": int(time.time()),
                "model": get_effective_config().model,
                "choices": [{"index": 0, "delta": {"content": text}, "finish_reason": None}],
            }
            return f"data: {json.dumps(openai_chunk)}\n\n"

    if evt_type == "message_stop":
        return "data: [DONE]\n\n"

    return None


async def _anthropic_stream(
    url: str,
    headers: dict,
    body: dict,
    timeout: int,
    llm_id: str,
    start: float,
) -> StreamingResponse:
    client = httpx.AsyncClient(timeout=timeout)
    collected: list[bytes] = []

    async def generator() -> AsyncIterator[bytes]:
        try:
            async with client.stream("POST", url, headers=headers, json=body) as resp:
                if resp.status_code != 200:
                    err = await resp.aread()
                    err_text = err.decode("utf-8", errors="replace")[:500]
                    logger.error("Anthropic 上游流式错误: %d %s", resp.status_code, err_text[:200])
                    await _finalize_error(llm_id, f"上游返回 {resp.status_code}: {err_text}", start)
                    yield f"data: {json.dumps({'error': resp.status_code})}\n\n".encode()
                    return
                async for line in resp.aiter_lines():
                    converted = _anthropic_sse_to_openai(line)
                    if converted:
                        chunk = converted.encode()
                        collected.append(chunk)
                        yield chunk
            output = assemble_stream_output(b"".join(collected))
            await _finalize_success(llm_id, output, start)
        except Exception as exc:
            logger.exception("Anthropic 流式代理异常: llm_id=%s", llm_id)
            partial = assemble_stream_output(b"".join(collected))
            await _finalize_error(llm_id, str(exc), start, partial_output=partial)
            raise
        finally:
            await client.aclose()

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            HEADER_LLM_ID: llm_id,
        },
    )


async def _anthropic_normal(
    url: str,
    headers: dict,
    body: dict,
    timeout: int,
    llm_id: str | None = None,
    start: float | None = None,
) -> dict:
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(url, headers=headers, json=body)
    if resp.status_code != 200:
        err_text = resp.text[:500]
        logger.error("Anthropic 上游错误: %d %s", resp.status_code, err_text[:200])
        if llm_id is not None and start is not None:
            await _finalize_error(llm_id, f"上游返回 {resp.status_code}: {err_text}", start)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY,
                            detail=f"Anthropic 上游返回 {resp.status_code}")
    data = _from_anthropic_response(resp.json())
    if llm_id is not None and start is not None:
        output = extract_text_from_openai_response(data)
        await _finalize_success(llm_id, output, start)
    return data


@router.post("/chat/completions", response_model=None)
async def proxy_chat_completions(request: Request) -> StreamingResponse | dict:
    body: dict[str, Any] = await request.json()
    ctx = extract_request_context(request)
    original_model = body.get("model", "<unset>")
    body = _apply_model(body)
    is_stream = body.get("stream", False)
    messages = body.get("messages", [])

    cfg = get_effective_config()
    llm_id = llm_record_store.new_llm_id()
    start = time.perf_counter()

    await llm_record_store.create_record(
        llm_id=llm_id,
        session_id=ctx.session_id,
        question_id=ctx.question_id,
        messages=messages,
        stream=is_stream,
        cfg=cfg,
        request_body=body,
    )

    logger.info(
        "LLM 代理: llm_id=%s session=%s question=%s protocol=%s model=%s (client=%s) stream=%s → %s",
        llm_id, ctx.session_id, ctx.question_id, cfg.protocol, cfg.model,
        original_model, is_stream, cfg.base_url,
    )

    if cfg.protocol == "anthropic":
        ant_body = _to_anthropic_request(body)
        url = _anthropic_upstream_url()
        headers = _anthropic_headers()
        if is_stream:
            return await _anthropic_stream(url, headers, ant_body, cfg.timeout, llm_id, start)
        result = await _anthropic_normal(url, headers, ant_body, cfg.timeout, llm_id, start)
        return JSONResponse(content=result, headers={HEADER_LLM_ID: llm_id})

    url = _openai_upstream_url("/chat/completions")
    headers = _openai_headers()
    if is_stream:
        return await _openai_stream(url, headers, body, cfg.timeout, llm_id, start)
    result = await _openai_normal(url, headers, body, cfg.timeout, llm_id, start)
    return JSONResponse(content=result, headers={HEADER_LLM_ID: llm_id})
