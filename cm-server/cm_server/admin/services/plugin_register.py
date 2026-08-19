"""本机插件发布后写入 mcp_servers，供 mcp-proxy 以 stdio 拉起。"""
from __future__ import annotations

import json
import logging
from pathlib import Path

from pi_shared import format_iso, now_china

from cm_server.admin.services.db import get_db
from cm_server.admin.services.plugin_runtime import resolve_plugin_python
from cm_server.admin.services.plugins_fs import PLUGIN_SERVER_FILE, plugin_dir
from cm_server.mcp_proxy.services.mcp_stdio_snapshot import snapshot_stdio_tools
from cm_server.shared.mcp_cache import invalidate_cache

logger = logging.getLogger(__name__)


async def register_local_plugin(
    *,
    name: str,
    description: str,
    user_id: str | None,
    enabled: bool = True,
) -> Path:
    dest = plugin_dir(name, user_id)
    server = dest / PLUGIN_SERVER_FILE
    if not server.is_file():
        raise ValueError("插件 server.py 不存在，无法注册")
    python_bin = resolve_plugin_python()
    now = format_iso(now_china())
    args_list = ["-u", str(server)]
    args = json.dumps(args_list)
    db = get_db()
    existing = await db.fetch_one(
        "SELECT 1 FROM mcp_servers WHERE name = ? AND "
        + ("user_id = ?" if user_id else "user_id IS NULL"),
        (name, user_id) if user_id else (name,),
    )
    if existing:
        if user_id:
            await db.execute(
                """
                UPDATE mcp_servers
                SET url = '', description = ?, enabled = ?, transport = 'stdio',
                    command = ?, args = ?, cwd = ?, updated_at = ?
                WHERE name = ? AND user_id = ?
                """,
                (description, int(enabled), python_bin, args, str(dest), now, name, user_id),
            )
        else:
            await db.execute(
                """
                UPDATE mcp_servers
                SET url = '', description = ?, enabled = ?, transport = 'stdio',
                    command = ?, args = ?, cwd = ?, updated_at = ?
                WHERE name = ? AND user_id IS NULL
                """,
                (description, int(enabled), python_bin, args, str(dest), now, name),
            )
    elif user_id:
        await db.execute(
            """
            INSERT INTO mcp_servers
            (name, user_id, url, description, api_key, enabled, transport, command, args, cwd, created_at, updated_at)
            VALUES (?, ?, '', ?, '', ?, 'stdio', ?, ?, ?, ?, ?)
            """,
            (name, user_id, description, int(enabled), python_bin, args, str(dest), now, now),
        )
    else:
        await db.execute(
            """
            INSERT INTO mcp_servers
            (name, user_id, url, description, api_key, enabled, transport, command, args, cwd, created_at, updated_at)
            VALUES (?, NULL, '', ?, '', ?, 'stdio', ?, ?, ?, ?, ?)
            """,
            (name, description, int(enabled), python_bin, args, str(dest), now, now),
        )
    await invalidate_cache(user_id, name)
    try:
        await snapshot_stdio_tools(
            name=name,
            user_id=user_id,
            command=python_bin,
            args=args_list,
            cwd=str(dest),
        )
    except Exception:
        logger.exception("插件工具清单快照失败 name=%s，将在首次列工具时再试", name)
    logger.info("插件已登记 mcp-proxy name=%s user=%s cwd=%s", name, user_id or "-", dest)
    return dest
