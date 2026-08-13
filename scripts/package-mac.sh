#!/usr/bin/env bash
# 一键打包 mac arm64 桌面安装包（.dmg）：依次构建 frontend / pi-runtime / pi-cli /
# cm-server / arxiv-mcp / nature-mcp 产物到 build/，再用 electron-builder 打成可拖到 Applications 的 dmg。
# 必须在 arm64 Mac 上运行（PyInstaller 不支持交叉编译）。
#
# 用法：bash scripts/package-mac.sh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ "$(uname -m)" != "arm64" ]]; then
  echo "错误：当前机器架构 $(uname -m) 不是 arm64，PyInstaller 无法交叉编译，请在 Apple Silicon Mac 上运行本脚本" >&2
  exit 1
fi

# 国内网络：electron / electron-builder 二进制默认走 GitHub，经常超时
export ELECTRON_MIRROR="${ELECTRON_MIRROR:-https://npmmirror.com/mirrors/electron/}"
export ELECTRON_BUILDER_BINARIES_MIRROR="${ELECTRON_BUILDER_BINARIES_MIRROR:-https://npmmirror.com/mirrors/electron-builder-binaries/}"
export NPM_CONFIG_REGISTRY="${NPM_CONFIG_REGISTRY:-https://registry.npmmirror.com}"

echo "════════════════════════════════════════"
echo " [1/8] 构建前端"
echo "════════════════════════════════════════"
bash "$ROOT_DIR/scripts/build-frontend.sh"

echo "════════════════════════════════════════"
echo " [2/8] 构建 pi-runtime"
echo "════════════════════════════════════════"
bash "$ROOT_DIR/scripts/build-pi-runtime.sh"

echo "════════════════════════════════════════"
echo " [3/8] 构建 pi CLI + 扩展（打入安装包，不再依赖本机全局 pi）"
echo "════════════════════════════════════════"
bash "$ROOT_DIR/scripts/build-pi-cli.sh"

echo "════════════════════════════════════════"
echo " [4/8] 构建沙盒内置 Python + 科学栈（体积会明显增加）"
echo "════════════════════════════════════════"
bash "$ROOT_DIR/scripts/build-sandbox-python.sh"

echo "════════════════════════════════════════"
echo " [5/8] 构建 cm-server（PyInstaller）"
echo "════════════════════════════════════════"
bash "$ROOT_DIR/scripts/build-cm-server.sh"

echo "════════════════════════════════════════"
echo " [6/8] 构建 arxiv-mcp（PyInstaller，打入安装包，不再依赖容器内 arxiv-mcp 主机名）"
echo "════════════════════════════════════════"
bash "$ROOT_DIR/scripts/build-arxiv-mcp.sh"

echo "════════════════════════════════════════"
echo " [7/8] 构建 nature-mcp（PyInstaller）"
echo "════════════════════════════════════════"
bash "$ROOT_DIR/scripts/build-nature-mcp.sh"

echo "════════════════════════════════════════"
echo " [8/8] electron-builder 打包 mac arm64 .dmg"
echo "════════════════════════════════════════"
cd "$ROOT_DIR/electron"
npm install
npm run dist:mac

echo ""
echo "==> 打包完成。可安装的 mac 安装包："
ls -lh "$ROOT_DIR/electron/release/"*.dmg
echo ""
echo "双击 .dmg → 把 Eidolon 拖到 Applications 即可安装。"
echo "（未签名，首次打开若被 Gatekeeper 拦截：右键 Eidolon → 打开）"
