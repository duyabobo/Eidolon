#!/usr/bin/env bash
# 构建前端静态产物到 build/frontend/，供 Electron 打包内置的本机静态服务器使用
# （electron/src/static-server.ts）。前端代码本身不做任何 Electron 专属改动——
# fetch 用的相对路径 /sessions /skills 等由 static-server.ts 反向代理到 cm-server，
# 与容器部署时 nginx.conf 的路由划分保持一致。
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="$ROOT_DIR/frontend"
OUT_DIR="$ROOT_DIR/build/frontend"

echo "==> 安装依赖并构建前端"
cd "$SRC_DIR"
npm install
npm run build

echo "==> 拷贝产物到 $OUT_DIR"
rm -rf "$OUT_DIR"
mkdir -p "$(dirname "$OUT_DIR")"
cp -R "$SRC_DIR/dist" "$OUT_DIR"

echo "==> 完成：$OUT_DIR"
