"""任务派发 + 轮次控制：CM 架构下替代原 gateway/services/redis_client.py（Redis Stream/Pub-Sub → 直连 pi-runtime HTTP）。

单机单用户场景只有一个 pi-runtime 进程，不存在多实例竞争消费，因此去掉 Redis Stream
Consumer Group/租约/死信队列，gateway 直接以 HTTP 调用 pi-runtime；任务入队幂等改用
本地 SQLite `task_dedupe` 表做 `INSERT OR IGNORE` 去重，语义与原 Redis `SET NX` 一致。
"""
import logging

import httpx
from fastapi import HTTPException, status
from pi_shared import format_iso, now_china

from cm_server.gateway.config import settings
from cm_server.gateway.services.db import get_db

logger = logging.getLogger(__name__)

_TASK_DEDUPE_TTL_SECONDS = 86400
_HTTP_TIMEOUT = httpx.Timeout(10.0, connect=3.0)


async def _call_pi_runtime(method: str, path: str, *, json: dict | None = None) -> httpx.Response:
    """调用 pi-runtime；失败时抛出 502，由路由层决定是否继续向前端暴露。

    trust_env=False：这是本机（同一进程组）内部调用，不能走用户系统代理——
    CM 桌面架构下用户机器很可能配了系统级代理，httpx 默认 trust_env=True 会把
    127.0.0.1/容器内部网络的请求也转发给代理，代理常无法回环访问自身而返回 502，
    表现为“pi-runtime 调用失败”，但其实 pi-runtime 进程本身完全正常。
    """
    url = f"{settings.pi_runtime_base_url}{path}"
    try:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT, trust_env=False) as client:
            resp = await client.request(method, url, json=json)
        resp.raise_for_status()
        return resp
    except httpx.HTTPError as exc:
        logger.error("pi-runtime 调用失败: %s %s error=%s", method, url, exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail="pi-runtime 暂不可用，请稍后重试"
        ) from exc


async def _call_pi_runtime_lenient(method: str, path: str) -> httpx.Response | None:
    """调用 pi-runtime，pi-runtime 不可达时返回 None 而不抛错（用于查询类/清理类调用，
    此时"无法连接"等价于"没有正在运行的任务"，不应阻塞前端）。"""
    try:
        return await _call_pi_runtime(method, path)
    except HTTPException:
        return None


async def _try_acquire_dedupe(task_id: str) -> bool:
    """返回 True 表示本次成功抢占（此前未入队过），False 表示重复任务应被抑制。"""
    try:
        await get_db().execute(
            "INSERT INTO task_dedupe (task_id, created_at) VALUES (?, ?)",
            (task_id, format_iso(now_china())),
        )
        return True
    except Exception:
        # PRIMARY KEY 冲突：task_id 已存在，说明重复投递
        return False


async def _dispatch_task(
    *,
    task_type: str,
    session_id: str,
    user_id: str,
    request: str,
    turn_id: str,
    skill_ids: list[str] | None,
    turn_policy: dict | None = None,
) -> None:
    task_id = f"{session_id}:{turn_id}"
    if not await _try_acquire_dedupe(task_id):
        logger.info("重复任务已抑制: task_id=%s type=%s", task_id, task_type)
        return

    payload = {
        "task_id": task_id,
        "task_type": task_type,
        "session_id": session_id,
        "user_id": user_id,
        "request": request,
        "turn_id": turn_id,
        "skill_ids": skill_ids or [],
    }
    if turn_policy:
        payload["turn_policy"] = turn_policy
    await _call_pi_runtime("POST", "/tasks", json=payload)
    logger.info(
        "任务已派发: task_id=%s type=%s intent=%s",
        task_id,
        task_type,
        (turn_policy or {}).get("intent") or "-",
    )


async def publish_task(
    session_id: str,
    user_id: str,
    request: str,
    turn_id: str,
    skill_ids: list[str] | None = None,
    turn_policy: dict | None = None,
) -> None:
    """创建/重建沙盒并发送第一条消息。"""
    await _dispatch_task(
        task_type="start",
        session_id=session_id,
        user_id=user_id,
        request=request,
        turn_id=turn_id,
        skill_ids=skill_ids,
        turn_policy=turn_policy,
    )


async def publish_message(
    session_id: str,
    user_id: str,
    request: str,
    turn_id: str,
    skill_ids: list[str] | None = None,
    turn_policy: dict | None = None,
) -> None:
    """向已有 session 发送新轮次。"""
    await _dispatch_task(
        task_type="message",
        session_id=session_id,
        user_id=user_id,
        request=request,
        turn_id=turn_id,
        skill_ids=skill_ids,
        turn_policy=turn_policy,
    )


async def publish_cancel(session_id: str, turn_id: str) -> None:
    """通知 pi-runtime 中断指定轮次的生成任务；pi-runtime 不可达时视为无活跃轮次可中断，不阻塞前端。"""
    await _call_pi_runtime_lenient("POST", f"/sessions/{session_id}/turns/{turn_id}/cancel")
    logger.info("中断信号已发送: session=%s turn=%s", session_id, turn_id)


async def get_active_turn(session_id: str) -> str | None:
    """查询 pi-runtime 内存中该 session 当前进行中的 turn_id；pi-runtime 不可达时视为无活跃轮次。"""
    resp = await _call_pi_runtime_lenient("GET", f"/sessions/{session_id}/active_turn")
    return resp.json().get("turn_id") if resp else None


async def close_session(session_id: str) -> None:
    """通知 pi-runtime 销毁 pi 进程和沙盒；pi-runtime 不可达时无需额外处理（进程已不存在）。"""
    await _call_pi_runtime_lenient("POST", f"/sessions/{session_id}/close")
    logger.info("session 关闭信号已发送: session_id=%s", session_id)
