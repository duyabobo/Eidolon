"""本机固定身份：按设备号生成，写入 app_config 后不再变。桌面单机，不是账户。"""
from __future__ import annotations

import hashlib
import logging
import platform
import re
import subprocess
import uuid
from pathlib import Path

from pi_shared import format_iso, now_china

from cm_server.shared.db import get_db

logger = logging.getLogger(__name__)

_CONFIG_KEY = "machine_user_id"
_LEGACY_DEFAULT_USER_ID = "0"
_UID_PREFIX = "e"
_HASH_HEX_LEN = 16
_IOREG_TIMEOUT_S = 5


def _macos_platform_uuid() -> str:
    completed = subprocess.run(
        ["ioreg", "-rd1", "-c", "IOPlatformExpertDevice"],
        capture_output=True,
        text=True,
        timeout=_IOREG_TIMEOUT_S,
        check=False,
    )
    if completed.returncode != 0:
        return ""
    match = re.search(r'"IOPlatformUUID"\s*=\s*"([^"]+)"', completed.stdout)
    return match.group(1).strip() if match else ""


def _linux_machine_id() -> str:
    for path in (Path("/etc/machine-id"), Path("/var/lib/dbus/machine-id")):
        if path.is_file():
            value = path.read_text(encoding="utf-8").strip()
            if value:
                return value
    return ""


def _windows_product_uuid() -> str:
    completed = subprocess.run(
        ["powershell", "-NoProfile", "-Command", "(Get-CimInstance Win32_ComputerSystemProduct).UUID"],
        capture_output=True,
        text=True,
        timeout=_IOREG_TIMEOUT_S,
        check=False,
    )
    if completed.returncode != 0:
        return ""
    return completed.stdout.strip()


def read_device_fingerprint() -> str:
    system = platform.system()
    if system == "Darwin":
        return _macos_platform_uuid()
    if system == "Linux":
        return _linux_machine_id()
    if system == "Windows":
        return _windows_product_uuid()
    return ""


def _uid_from_fingerprint(fingerprint: str) -> str:
    digest = hashlib.sha256(f"eidolon:{fingerprint}".encode("utf-8")).hexdigest()
    return f"{_UID_PREFIX}{digest[:_HASH_HEX_LEN]}"


async def _read_stored() -> str:
    row = await get_db().fetch_one("SELECT value FROM app_config WHERE key = ?", (_CONFIG_KEY,))
    value = str(row["value"]).strip() if row and row.get("value") else ""
    return value


async def _write_stored(user_id: str) -> None:
    now = format_iso(now_china())
    await get_db().execute(
        """
        INSERT INTO app_config (key, value, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        """,
        (_CONFIG_KEY, user_id, now),
    )


async def _has_legacy_default_user() -> bool:
    row = await get_db().fetch_one(
        "SELECT 1 FROM sessions WHERE user_id = ? LIMIT 1",
        (_LEGACY_DEFAULT_USER_ID,),
    )
    return row is not None


async def current_user_id() -> str:
    """本机唯一身份，路由层用这个，不再从请求里收 user_id。"""
    return await get_machine_user_id()


async def owner_id_for_scope(scope: str | None) -> str | None:
    """system → None；user → 本机身份。"""
    if (scope or "").strip().lower() == "user":
        return await current_user_id()
    return None


async def get_machine_user_id() -> str:
    stored = await _read_stored()
    if stored:
        return stored

    if await _has_legacy_default_user():
        user_id = _LEGACY_DEFAULT_USER_ID
        source = "legacy"
    else:
        fingerprint = read_device_fingerprint()
        if fingerprint:
            user_id = _uid_from_fingerprint(fingerprint)
            source = "device"
        else:
            user_id = f"{_UID_PREFIX}{uuid.uuid4().hex[:_HASH_HEX_LEN]}"
            source = "random"

    await _write_stored(user_id)
    logger.info("本机身份已生成 source=%s user_id=%s", source, user_id)
    return user_id
