"""
arxiv-mcp 启动入口：先按平台统一方式初始化日志，再启动官方 server。

日志：/app/logs/arxiv-mcp.log，按天切割，保留 7 天（pi_shared.setup_logging）。
"""
from __future__ import annotations

import asyncio
import logging

import uvicorn
from pi_shared import setup_logging

setup_logging("arxiv-mcp")
logger = logging.getLogger(__name__)

# 官方 server 内部用 uvicorn.Config(... log_level=...) 默认会 dictConfig 覆盖 root；
# 显式 log_config=None，保留我们挂好的文件/控制台 handler。
_OrigConfig = uvicorn.Config


class _Config(_OrigConfig):  # type: ignore[misc,valid-type]
    def __init__(self, *args, **kwargs):  # noqa: ANN002,ANN003
        kwargs.setdefault("log_config", None)
        super().__init__(*args, **kwargs)


uvicorn.Config = _Config  # type: ignore[misc,assignment]


def main() -> None:
    from arxiv_mcp_server.server import main as arxiv_main

    logger.info("arxiv-mcp 启动中（Streamable HTTP）")
    asyncio.run(arxiv_main())


if __name__ == "__main__":
    main()
