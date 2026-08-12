"""本地 SQLite 文件默认路径。

不能用 `__file__` 反推仓库根目录：生产环境里 pi-shared 是 `pip install` 到
site-packages 的副本，`__file__` 指向安装位置而非源码树，会算出一个完全不相关
的路径。改用「当前工作目录的上一级」：
- 本地开发时各服务以自己的目录为 cwd（如 `cd gateway && uvicorn main:app`），
  上一级正好是仓库根目录；
- Docker 容器内 `WORKDIR /app`，上一级是 `/`，落在 `/data/local.db`，与现有
  `SANDBOX_ROOT=/data/sandboxes` 的挂载方式保持一致。

Electron 打包后应显式通过 `SQLITE_PATH` 环境变量覆盖为 `app.getPath('userData')`
下的路径，不依赖这个默认值。
"""
from pathlib import Path


def default_local_db_path() -> str:
    return str(Path.cwd().parent / "data" / "local.db")
