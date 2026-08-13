"""
nature-mcp 启动入口：先按平台统一方式初始化日志，再启动 MCP server。

默认 TRANSPORT=streamable-http（Docker / Electron）；本地 CC-Switch 可用 TRANSPORT=stdio。
有 pi_shared 时日志写入 LOG_DIR；裸跑（stdio）退回标准 logging。
"""
from __future__ import annotations

import logging
import os

try:
    import uvicorn
    from pi_shared import setup_logging

    setup_logging("nature-mcp")
    _OrigConfig = uvicorn.Config

    class _Config(_OrigConfig):  # type: ignore[misc,valid-type]
        def __init__(self, *args, **kwargs):  # noqa: ANN002,ANN003
            kwargs.setdefault("log_config", None)
            super().__init__(*args, **kwargs)

    uvicorn.Config = _Config  # type: ignore[misc,assignment]
except ImportError:
    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO"),
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    )

logger = logging.getLogger(__name__)


def main() -> None:
    # Docker / Electron 未显式设置时默认 HTTP，避免误走 stdio 挂死
    if not os.environ.get("TRANSPORT"):
        # 无 TTY 且被 MCP 客户端拉起时常走 stdio；有 PORT/HOST 倾向 HTTP
        if os.environ.get("PORT") or os.environ.get("HOST"):
            os.environ["TRANSPORT"] = "streamable-http"
        else:
            os.environ["TRANSPORT"] = "stdio"

    from nature_mcp.server import main as nature_main

    logger.info("nature-mcp 启动中 transport=%s", os.environ.get("TRANSPORT"))
    nature_main()


if __name__ == "__main__":
    main()
