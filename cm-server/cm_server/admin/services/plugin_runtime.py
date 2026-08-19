"""本机插件运行解释器：优先安装包内沙盒 Python，其次配置项，最后当前进程。"""
from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path

from cm_server.config import settings


def resolve_plugin_python() -> str:
    configured = (settings.plugin_python or "").strip()
    if configured:
        return configured
    sandbox_bin = (os.environ.get("SANDBOX_PYTHON_BIN_DIR") or "").strip()
    if sandbox_bin:
        candidate = Path(sandbox_bin) / "python3"
        if candidate.is_file():
            return str(candidate)
    which = shutil.which("python3")
    if which:
        return which
    return sys.executable
