#!/usr/bin/env bash
# 构建 pi-runtime 到 build/pi-runtime/，供 Electron extraResources 打入 .app。
#
# pi-runtime 不打成单文件可执行程序：Electron 用内置 Node（ELECTRON_RUN_AS_NODE=1）
# 直接运行 dist/worker.js（见 electron/src/process-manager.ts 的 startPiRuntime），
# 所以只需要「tsc 编译产物 + 生产依赖 node_modules + extensions 目录」这三样，
# 不需要额外的打包工具。
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="$ROOT_DIR/pi-runtime"
OUT_DIR="$ROOT_DIR/build/pi-runtime"

echo "==> [1/3] 安装依赖并编译 TypeScript"
cd "$SRC_DIR"
npm install
npm run build

echo "==> [2/3] 拷贝产物到 $OUT_DIR"
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"
cp -R "$SRC_DIR/dist" "$OUT_DIR/dist"
cp -R "$SRC_DIR/extensions" "$OUT_DIR/extensions"
cp "$SRC_DIR/package.json" "$OUT_DIR/package.json"
cp "$SRC_DIR/package-lock.json" "$OUT_DIR/package-lock.json" 2>/dev/null || true

echo "==> [3/3] 只安装生产依赖（--omit=dev，Electron 不需要 ts-node/typescript）"
cd "$OUT_DIR"
npm install --omit=dev

echo "==> 完成：$OUT_DIR"
echo "pi CLI 与扩展由 scripts/build-pi-cli.sh 单独打进 build/pi-cli，Electron 启动时通过"
echo "PI_BIN / PI_EXTENSIONS_DIR / NODE_BIN 注入（见 electron/src/process-manager.ts）。"
