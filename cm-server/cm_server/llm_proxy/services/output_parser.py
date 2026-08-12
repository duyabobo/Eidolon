import json
from typing import Any


def extract_text_from_openai_response(resp: dict[str, Any]) -> str:
    choices = resp.get("choices", [])
    if not choices:
        return ""
    message = choices[0].get("message", {})
    content = message.get("content", "")
    return content if isinstance(content, str) else ""


def extract_text_from_sse_line(line: str) -> str:
    """从 OpenAI SSE 行提取文本增量，无法解析时返回空串。"""
    if not line.startswith("data:"):
        return ""
    raw = line[5:].strip()
    if not raw or raw == "[DONE]":
        return ""
    try:
        evt = json.loads(raw)
    except json.JSONDecodeError:
        return ""
    choices = evt.get("choices", [])
    if not choices:
        return ""
    delta = choices[0].get("delta", {})
    content = delta.get("content", "")
    return content if isinstance(content, str) else ""


def assemble_stream_output(raw_bytes: bytes) -> str:
    text = raw_bytes.decode("utf-8", errors="replace")
    parts: list[str] = []
    for line in text.splitlines():
        chunk = extract_text_from_sse_line(line)
        if chunk:
            parts.append(chunk)
    return "".join(parts)
