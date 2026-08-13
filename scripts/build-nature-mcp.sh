#!/usr/bin/env bash
# 用 PyInstaller 把 nature-mcp 打成单机可执行程序（onedir 模式），产物拷贝到 build/nature-mcp/，
# 供 Electron extraResources 使用。
#
# 用法：bash scripts/build-nature-mcp.sh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="$ROOT_DIR/nature-mcp"
OUT_DIR="$ROOT_DIR/build/nature-mcp"
VENV_DIR="$SRC_DIR/.pyinstaller-venv"

echo "==> [1/3] 准备独立虚拟环境: $VENV_DIR"
python3 -m venv "$VENV_DIR"
# shellcheck source=/dev/null
source "$VENV_DIR/bin/activate"
pip install --upgrade pip -q
pip install "$ROOT_DIR/pi-shared" -q
pip install "$SRC_DIR" -q
pip install pyinstaller -q
# --collect-all mcp 会扫描 mcp.cli，缺 typer 会让构建失败
pip install typer -q

echo "==> [2/3] 执行 PyInstaller"
rm -rf "$SRC_DIR/build" "$SRC_DIR/dist" "$SRC_DIR/nature-mcp.spec"
pyinstaller \
  --name nature-mcp \
  --onedir \
  --clean \
  --noconfirm \
  --distpath "$SRC_DIR/dist" \
  --workpath "$SRC_DIR/build" \
  --specpath "$SRC_DIR" \
  --collect-all nature_mcp \
  --collect-all mcp \
  --exclude-module mcp.cli \
  --collect-all uvicorn \
  --collect-all httpx \
  --collect-all httpcore \
  "$SRC_DIR/entrypoint.py"

deactivate

echo "==> [3/3] 拷贝产物到 $OUT_DIR"
rm -rf "$OUT_DIR"
mkdir -p "$(dirname "$OUT_DIR")"
cp -R "$SRC_DIR/dist/nature-mcp" "$OUT_DIR"

echo "==> 完成：$OUT_DIR/nature-mcp（TRANSPORT=streamable-http PORT=8082 可直接执行）"
