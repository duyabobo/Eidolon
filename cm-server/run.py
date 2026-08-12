"""PyInstaller 打包入口：容器/开发环境用 `uvicorn cm_server.main:app` 命令行启动，
但 PyInstaller 只能打包成「运行一个 Python 脚本」的可执行文件，需要一个显式调用
`uvicorn.run(...)` 的入口模块。Electron 主进程 spawn 打包后的可执行文件时按下面的
环境变量传参，与容器环境完全一致（见 cm_server/config.py 的 Settings 字段名）。
"""
import uvicorn

from cm_server.config import settings
from cm_server.main import app

if __name__ == "__main__":
    uvicorn.run(
        app,
        host=settings.cm_server_host,
        port=settings.cm_server_port,
        log_config=None,  # 复用 pi_shared.setup_logging 已配置的 root logger，不用 uvicorn 默认配置覆盖
    )
