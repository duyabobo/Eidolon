#!/usr/bin/env bash
# 用 PyInstaller 把 cm-server 打成单机可执行程序（onedir 模式，比 onefile 启动快、
# 排查缺失依赖更容易），产物拷贝到 build/cm-server/，供 Electron extraResources 使用。
#
# 用法：bash scripts/build-cm-server.sh
# 注意：PyInstaller 不支持交叉编译，必须在目标架构机器上运行（mac arm64 打包需在 arm64 Mac 上跑本脚本）。
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="$ROOT_DIR/cm-server"
OUT_DIR="$ROOT_DIR/build/cm-server"
VENV_DIR="$SRC_DIR/.pyinstaller-venv"

echo "==> [1/3] 准备独立虚拟环境（不污染开发环境依赖）: $VENV_DIR"
python3 -m venv "$VENV_DIR"
# shellcheck source=/dev/null
source "$VENV_DIR/bin/activate"
pip install --upgrade pip -q
pip install -r "$SRC_DIR/requirements.txt" -q
pip install "$ROOT_DIR/pi-shared" -q
pip install pyinstaller -q
# mcp[cli] 的 typer 不是 cm-server 运行时依赖（只用 mcp 的 client SDK），但 PyInstaller
# 的 --collect-all mcp 会连带扫描 mcp.cli 子模块触发 import，缺 typer 直接让整个构建失败；
# 装上即可满足扫描期 import，不影响最终产物体积（PyInstaller 只按实际 import 图裁剪）。
pip install typer -q

echo "==> [2/3] 执行 PyInstaller"
rm -rf "$SRC_DIR/build" "$SRC_DIR/dist" "$SRC_DIR/cm-server.spec"
pyinstaller \
  --name cm-server \
  --onedir \
  --clean \
  --noconfirm \
  --distpath "$SRC_DIR/dist" \
  --workpath "$SRC_DIR/build" \
  --specpath "$SRC_DIR" \
  --collect-all mcp \
  --exclude-module mcp.cli \
  --collect-all uvicorn \
  --collect-all httpx \
  --collect-all httpcore \
  --collect-submodules cm_server \
  --paths "$SRC_DIR" \
  "$SRC_DIR/run.py"

deactivate

echo "==> [3/3] 拷贝产物到 $OUT_DIR"
rm -rf "$OUT_DIR"
mkdir -p "$(dirname "$OUT_DIR")"
cp -R "$SRC_DIR/dist/cm-server" "$OUT_DIR"

echo "==> 完成：$OUT_DIR/cm-server（可直接执行，验证：$OUT_DIR/cm-server --help 或直接启动后访问 /health）"
