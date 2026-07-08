import logging
from datetime import datetime
from typing import Any

from models.mcp import McpScope, McpServerItem
from services.mongo_client import get_db

logger = logging.getLogger(__name__)

_COLLECTION = "mcp_servers"


def _system_user_filter() -> dict[str, Any]:
    return {"$or": [{"user_id": None}, {"user_id": {"$exists": False}}]}


def _meta_key(name: str, user_id: str | None) -> dict[str, Any]:
    return {"name": name, "user_id": user_id}


def _to_item(raw: dict[str, Any]) -> McpServerItem:
    user_id = raw.get("user_id")
    return McpServerItem(
        name=str(raw["name"]),
        url=str(raw["url"]),
        description=str(raw.get("description") or ""),
        enabled=bool(raw.get("enabled", True)),
        has_api_key=bool(str(raw.get("api_key") or "").strip()),
        scope=McpScope.USER if user_id else McpScope.SYSTEM,
        user_id=str(user_id) if user_id else None,
    )


async def ensure_mcp_indexes() -> None:
    await get_db()[_COLLECTION].create_index(
        [("user_id", 1), ("name", 1)],
        unique=True,
        name="mcp_user_name_unique",
    )


async def list_mcp_for_user(
    user_id: str | None,
    *,
    include_disabled: bool = False,
) -> list[McpServerItem]:
    db = get_db()
    system_filter = _system_user_filter()
    system_query: dict[str, Any] = dict(system_filter)
    if not include_disabled:
        system_query["enabled"] = {"$ne": False}
    cursor = db[_COLLECTION].find(system_query)
    items = [_to_item(raw) async for raw in cursor]

    if user_id and user_id.strip():
        uid = user_id.strip()
        user_query: dict[str, Any] = {"user_id": uid}
        if not include_disabled:
            user_query["enabled"] = {"$ne": False}
        user_cursor = db[_COLLECTION].find(user_query)
        items.extend([_to_item(raw) async for raw in user_cursor])

    items.sort(key=lambda item: (item.scope.value, item.name))
    return items


async def upsert_user_server(
    user_id: str,
    name: str,
    url: str,
    description: str,
    enabled: bool,
    api_key: str = "",
) -> McpServerItem:
    now = datetime.utcnow()
    existing = await get_db()[_COLLECTION].find_one(_meta_key(name, user_id))
    resolved_key = api_key.strip()
    if not resolved_key and existing and existing.get("api_key"):
        resolved_key = str(existing["api_key"])

    doc = {
        "name": name,
        "user_id": user_id,
        "url": url,
        "description": description,
        "enabled": enabled,
        "api_key": resolved_key,
        "updated_at": now,
    }
    await get_db()[_COLLECTION].update_one(
        _meta_key(name, user_id),
        {"$set": doc, "$setOnInsert": {"created_at": now}},
        upsert=True,
    )
    return McpServerItem(
        name=name,
        url=url,
        description=description,
        enabled=enabled,
        has_api_key=bool(resolved_key),
        scope=McpScope.USER,
        user_id=user_id,
    )


async def delete_user_server(user_id: str, name: str) -> bool:
    result = await get_db()[_COLLECTION].delete_one(_meta_key(name, user_id))
    return result.deleted_count > 0
