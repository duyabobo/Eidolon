"""MinerU3 HTTP 客户端：POST /tasks + 轮询结果（不依赖本地 mineru 包）。"""
from __future__ import annotations

import base64
import logging
import mimetypes
import time
from pathlib import Path
from typing import Any

import httpx

from urllib.parse import urlparse

from cm_server.mrag.settings import MragRuntimeSettings

logger = logging.getLogger(__name__)

_API_RESTART_HTTP_STATUS_CODES = {502, 503, 504}
_API_RESTART_RETRY_WAIT_SECONDS = (10, 20, 30)


class MinerU3ApiUnavailableError(RuntimeError):
    pass


def _guess_mime(path: Path) -> str:
    return mimetypes.guess_type(path.name)[0] or "application/octet-stream"


def _raise_if_unavailable(action: str, status_code: int, body: str) -> None:
    if status_code in _API_RESTART_HTTP_STATUS_CODES:
        raise MinerU3ApiUnavailableError(
            f"[MinerU3] {action}时 mineru-api 不可用: {status_code} {body[:500]}"
        )


def _is_restart_error(exc: BaseException) -> bool:
    if isinstance(exc, MinerU3ApiUnavailableError):
        return True
    if isinstance(
        exc,
        (
            httpx.ConnectError,
            httpx.ConnectTimeout,
            httpx.ReadError,
            httpx.WriteError,
            httpx.RemoteProtocolError,
            httpx.PoolTimeout,
        ),
    ):
        return True
    return False


def _resolve_result_url(base_url: str, task_id: str, result_url: str | None) -> str:
    """始终基于配置的 mineru base 构造轮询地址。

    服务端返回的绝对 result_url 常丢掉反向代理端口/前缀，例如：
    提交 http://host:38026/mineru3/tasks，
    却返回 http://host/tasks/{id}/result → 502，且同步重试会堵死事件循环。
    """
    configured = f"{base_url.rstrip('/')}/tasks/{task_id}/result"
    if not result_url or not str(result_url).strip():
        return configured
    raw = str(result_url).strip()
    path = urlparse(raw).path if "://" in raw else (raw if raw.startswith("/") else f"/{raw}")
    if "/tasks/" in path and path.rstrip("/").endswith("/result"):
        suffix = path[path.index("/tasks/") :]
        return f"{base_url.rstrip('/')}{suffix}"
    return configured


def _auth_headers(api_key: str) -> dict[str, str]:
    key = (api_key or "").strip()
    return {"Authorization": f"Bearer {key}"} if key else {}


def _format_submit_error(status_code: int, body: str, file_path: Path) -> str:
    size_mb = file_path.stat().st_size / (1024 * 1024)
    if status_code == 413:
        return (
            f"[MinerU3] 提交失败: 文件过大（{size_mb:.1f}MB），"
            "被 mineru 前置 nginx 拒绝（413）。请在 mineru 侧增大 client_max_body_size"
        )
    detail = body.strip()
    if detail.lower().startswith("<html") or "<title>" in detail.lower():
        detail = detail[:120].replace("\n", " ")
    else:
        detail = detail[:300]
    return f"[MinerU3] 提交失败: HTTP {status_code} {detail}"


def _submit_and_wait_once(file_path: Path, runtime: MragRuntimeSettings) -> dict[str, Any]:
    base_url = runtime.mineru3_api_base.rstrip("/")
    headers = _auth_headers(runtime.mineru3_api_key)
    form_data = {
        "lang_list": runtime.mineru3_lang,
        "backend": runtime.mineru3_backend,
        "parse_method": runtime.mineru3_parse_method,
        "formula_enable": "true",
        "table_enable": "true",
        "return_md": "true",
        "return_content_list": "true",
        "return_images": "true",
    }

    try:
        with httpx.Client(
            base_url=base_url,
            timeout=runtime.mineru3_submit_timeout_seconds,
            trust_env=False,
        ) as client:
            with open(file_path, "rb") as f:
                files = [("files", (file_path.name, f, _guess_mime(file_path)))]
                logger.info(
                    "[MinerU3] 开始提交: file=%s size=%d base=%s has_key=%s",
                    file_path.name,
                    file_path.stat().st_size,
                    base_url,
                    bool(headers),
                )
                submit_resp = client.post("/tasks", data=form_data, files=files, headers=headers)
            _raise_if_unavailable("提交任务", submit_resp.status_code, submit_resp.text)
            if submit_resp.status_code != 202:
                raise RuntimeError(_format_submit_error(submit_resp.status_code, submit_resp.text, file_path))
            payload = submit_resp.json()
            task_id = payload.get("task_id")
            if not task_id:
                raise RuntimeError(f"[MinerU3] 提交响应缺少 task_id: {payload}")
            result_url = _resolve_result_url(base_url, str(task_id), payload.get("result_url"))
            logger.info(
                "[MinerU3] 任务已提交: file=%s task_id=%s backend=%s poll=%s",
                file_path.name,
                task_id,
                runtime.mineru3_backend,
                result_url,
            )

            poll_start = time.time()
            deadline = poll_start + runtime.mineru3_poll_timeout_seconds
            while time.time() < deadline:
                result_resp = client.get(
                    result_url,
                    timeout=runtime.mineru3_submit_timeout_seconds,
                    headers=headers,
                )
                _raise_if_unavailable("查询结果", result_resp.status_code, result_resp.text)
                if result_resp.status_code == 200:
                    logger.info(
                        "[MinerU3] 完成: file=%s task_id=%s elapsed=%.1fs",
                        file_path.name,
                        task_id,
                        time.time() - poll_start,
                    )
                    return result_resp.json()
                if result_resp.status_code == 202:
                    time.sleep(runtime.mineru3_poll_interval_seconds)
                    continue
                if result_resp.status_code == 409:
                    detail = result_resp.json()
                    raise RuntimeError(
                        f"[MinerU3] 解析失败: task_id={task_id} "
                        f"error={detail.get('error') or detail.get('message')}"
                    )
                raise RuntimeError(
                    f"[MinerU3] 查询异常: {result_resp.status_code} {result_resp.text[:500]}"
                )
    except httpx.HTTPError as exc:
        if isinstance(exc, httpx.ReadTimeout):
            raise
        raise MinerU3ApiUnavailableError(f"[MinerU3] 传输失败: {exc}") from exc

    raise TimeoutError(
        f"[MinerU3] 等待超时（{runtime.mineru3_poll_timeout_seconds:.0f}s）: task_id={task_id}"
    )


def submit_and_wait(file_path: Path, runtime: MragRuntimeSettings) -> dict[str, Any]:
    last_error: BaseException | None = None
    max_attempts = len(_API_RESTART_RETRY_WAIT_SECONDS) + 1
    for attempt in range(max_attempts):
        try:
            return _submit_and_wait_once(file_path, runtime)
        except Exception as exc:
            last_error = exc
            if not _is_restart_error(exc) or attempt >= len(_API_RESTART_RETRY_WAIT_SECONDS):
                raise
            wait_seconds = _API_RESTART_RETRY_WAIT_SECONDS[attempt]
            logger.warning(
                "[MinerU3] 可能重启，%ss 后重试 (%s/%s): %s",
                wait_seconds,
                attempt + 1,
                len(_API_RESTART_RETRY_WAIT_SECONDS),
                exc,
            )
            time.sleep(wait_seconds)
    assert last_error is not None
    raise last_error


def extract_markdown_and_images(
    result: dict[str, Any],
    image_dir: Path,
) -> tuple[str, list[Path]]:
    image_dir.mkdir(parents=True, exist_ok=True)
    md = ""
    results = result.get("results") or result.get("data") or result
    if isinstance(results, dict):
        for _name, payload in results.items():
            if not isinstance(payload, dict):
                continue
            md = payload.get("md_content") or payload.get("markdown") or md
            images = payload.get("images") or {}
            saved = _save_images(images, image_dir)
            if md:
                return md, saved
        md = results.get("md_content") or results.get("markdown") or ""
        saved = _save_images(results.get("images") or {}, image_dir)
        return md, saved

    if isinstance(results, list) and results:
        first = results[0]
        if isinstance(first, dict):
            md = first.get("md_content") or first.get("markdown") or ""
            saved = _save_images(first.get("images") or {}, image_dir)
            return md, saved

    raise RuntimeError("[MinerU3] 响应中未找到 markdown 内容")


def _save_images(images: dict[str, Any], image_dir: Path) -> list[Path]:
    saved: list[Path] = []
    if not isinstance(images, dict):
        return saved
    for name, data_uri in images.items():
        if not isinstance(data_uri, str):
            continue
        path = image_dir / Path(name).name
        if data_uri.startswith("data:"):
            _, _, b64_data = data_uri.partition(",")
            path.write_bytes(base64.b64decode(b64_data))
        else:
            continue
        saved.append(path)
    return saved


def parse_file_to_markdown(
    file_path: Path,
    work_dir: Path,
    runtime: MragRuntimeSettings,
) -> tuple[str, list[Path]]:
    result = submit_and_wait(file_path, runtime)
    image_dir = work_dir / "images"
    return extract_markdown_and_images(result, image_dir)
