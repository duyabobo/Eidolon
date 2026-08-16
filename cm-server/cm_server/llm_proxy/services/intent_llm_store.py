"""意图识别小模型配置，存 app_config.intent_llm；未配置时由调用方静默兜底聊天大模型。"""
from __future__ import annotations

import logging

from pi_shared import format_iso, now_china
from pi_shared.sqlite import dumps, loads

from cm_server.llm_proxy.models.config import IntentLlmConfig
from cm_server.llm_proxy.services.db import get_db

logger = logging.getLogger(__name__)

_CONFIG_KEY = "intent_llm"
_LEGACY_PROFILE_KEY = "llm_intent_profile_id"
_DEFAULT_TIMEOUT_S = 12


def _normalize_url(url: str) -> str:
    trimmed = (url or "").strip()
    if not trimmed:
        return ""
    if "://" not in trimmed:
        return f"http://{trimmed}"
    return trimmed.rstrip("/")


def _row_to_config(raw: str | None) -> IntentLlmConfig:
    data = loads(raw, {}) or {}
    if not isinstance(data, dict):
        data = {}
    timeout = data.get("timeout")
    try:
        timeout_s = int(timeout) if timeout is not None else _DEFAULT_TIMEOUT_S
    except (TypeError, ValueError):
        timeout_s = _DEFAULT_TIMEOUT_S
    protocol = str(data.get("protocol") or "openai")
    if protocol not in ("openai", "anthropic"):
        protocol = "openai"
    return IntentLlmConfig(
        base_url=_normalize_url(str(data.get("base_url") or "")),
        api_key=str(data.get("api_key") or ""),
        model=str(data.get("model") or "").strip(),
        timeout=timeout_s,
        protocol=protocol,
    )


async def get_intent_llm_config() -> IntentLlmConfig:
    row = await get_db().fetch_one(
        "SELECT value FROM app_config WHERE key = ?",
        (_CONFIG_KEY,),
    )
    cfg = _row_to_config(row["value"] if row else None)
    if cfg.configured:
        return cfg
    migrated = await _migrate_legacy_profile()
    return migrated or cfg


async def save_intent_llm_config(cfg: IntentLlmConfig) -> IntentLlmConfig:
    now = format_iso(now_china())
    payload = IntentLlmConfig(
        base_url=_normalize_url(cfg.base_url),
        api_key=(cfg.api_key or "").strip(),
        model=(cfg.model or "").strip(),
        timeout=cfg.timeout or _DEFAULT_TIMEOUT_S,
        protocol=cfg.protocol or "openai",
    )
    if payload.base_url and not payload.model:
        raise ValueError("请填写模型名")
    if payload.model and not payload.base_url:
        raise ValueError("请填写 Base URL")
    value = dumps(payload.model_dump(mode="json"))
    await get_db().execute(
        """
        INSERT INTO app_config (key, value, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        """,
        (_CONFIG_KEY, value, now),
    )
    logger.info(
        "意图识别小模型已保存 configured=%s model=%s",
        payload.configured,
        payload.model or "-",
    )
    return payload


async def _migrate_legacy_profile() -> IntentLlmConfig | None:
    row = await get_db().fetch_one(
        "SELECT value FROM app_config WHERE key = ?",
        (_LEGACY_PROFILE_KEY,),
    )
    profile_id = str(row["value"]).strip() if row and row.get("value") else ""
    if not profile_id:
        return None
    from cm_server.llm_proxy.services.llm_profile_store import get_llm_profile

    profile = await get_llm_profile(profile_id)
    await get_db().execute("DELETE FROM app_config WHERE key = ?", (_LEGACY_PROFILE_KEY,))
    if profile is None or not profile.base_url.strip() or not profile.model.strip():
        logger.info("旧版意图模型指针已清理 id=%s", profile_id)
        return None
    saved = await save_intent_llm_config(
        IntentLlmConfig(
            base_url=profile.base_url,
            api_key=profile.api_key,
            model=profile.model,
            timeout=min(int(profile.timeout or _DEFAULT_TIMEOUT_S), _DEFAULT_TIMEOUT_S),
            protocol=profile.protocol,
        )
    )
    logger.info("已迁移旧版意图模型指针 id=%s model=%s", profile_id, saved.model)
    return saved
