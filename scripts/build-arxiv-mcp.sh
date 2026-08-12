#!/usr/bin/env bash
# 用 PyInstaller 把 arxiv-mcp 打成单机可执行程序（onedir 模式），产物拷贝到 build/arxiv-mcp/，
# 供 Electron extraResources 使用。桌面端把它当第 3 个子进程拉起（见
# electron/src/process-manager.ts 的 startArxivMcp），不再要求用户自己起一个远程 MCP 服务。
#
# 用法：bash scripts/build-arxiv-mcp.sh
# 注意：PyInstaller 不支持交叉编译，必须在目标架构机器上运行（mac arm64 打包需在 arm64 Mac 上跑本脚本）。
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="$ROOT_DIR/arxiv-mcp"
OUT_DIR="$ROOT_DIR/build/arxiv-mcp"
VENV_DIR="$SRC_DIR/.pyinstaller-venv"

echo "==> [1/3] 准备独立虚拟环境（不污染开发环境依赖）: $VENV_DIR"
python3 -m venv "$VENV_DIR"
# shellcheck source=/dev/null
source "$VENV_DIR/bin/activate"
pip install --upgrade pip -q
pip install "$ROOT_DIR/pi-shared" -q
# 与 arxiv-mcp/Dockerfile 保持一致（未锁版本）；PyInstaller 打包后版本即固定在产物里，
# 后续升级需要同时改这里和 Dockerfile，二者应装到同一个版本。
pip install 'arxiv-mcp-server[pdf]' -q
pip install pyinstaller -q
# mcp[cli] 的 typer 不是运行时依赖（entrypoint.py 只用 mcp 的 server SDK），但 PyInstaller
# 的 --collect-all mcp 会连带扫描 mcp.cli 子模块触发 import，缺 typer 直接让整个构建失败
# （与 scripts/build-cm-server.sh 同一个坑，见那边的注释）。
pip install typer -q

echo "==> [2/3] 执行 PyInstaller"
rm -rf "$SRC_DIR/build" "$SRC_DIR/dist" "$SRC_DIR/arxiv-mcp.spec"
pyinstaller \
  --name arxiv-mcp \
  --onedir \
  --clean \
  --noconfirm \
  --distpath "$SRC_DIR/dist" \
  --workpath "$SRC_DIR/build" \
  --specpath "$SRC_DIR" \
  --collect-all arxiv_mcp_server \
  --collect-all mcp \
  --exclude-module mcp.cli \
  --collect-all uvicorn \
  --collect-all httpx \
  --collect-all httpcore \
  --collect-all pymupdf \
  --collect-all pymupdf4llm \
  "$SRC_DIR/entrypoint.py"

deactivate

echo "==> [3/3] 拷贝产物到 $OUT_DIR"
rm -rf "$OUT_DIR"
mkdir -p "$(dirname "$OUT_DIR")"
cp -R "$SRC_DIR/dist/arxiv-mcp" "$OUT_DIR"

echo "==> 完成：$OUT_DIR/arxiv-mcp（可直接执行，验证：$OUT_DIR/arxiv-mcp --storage-path /tmp/arxiv-papers，另开终端 curl 探测 PORT）"
