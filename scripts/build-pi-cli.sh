#!/usr/bin/env bash
# 把 pi CLI（@earendil-works/pi-coding-agent）和运行所需扩展打进 build/pi-cli/，
# 供 Electron extraResources 打入 .app，桌面端不再依赖用户机器上的全局 `npm install -g pi`。
#
# 布局对齐容器 Dockerfile 的语义（见 pi-runtime/Dockerfile）：
#   build/pi-cli/
#     bin/pi                                          # 包装脚本，用 NODE_BIN（缺省 node）跑 cli.js
#     bin/fd  bin/rg                                  # 搜索工具（沙盒禁网，不能运行时从 GitHub 拉）
#     node_modules/@earendil-works/pi-coding-agent/   # 锁定版本的 CLI 本体
#     extensions/pi-mcp-adapter/                      # MCP 适配器扩展
#     extensions/bwrap/                               # 沙盒内路径白名单扩展（macOS 同样需要）
#
# 用法：bash scripts/build-pi-cli.sh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT_DIR/build/pi-cli"
CACHE_DIR="$ROOT_DIR/build/cache"
# 与 pi-runtime/Dockerfile 的 ARG PI_VERSION 保持一致，升级时两边一起改
PI_VERSION="${PI_VERSION:-0.79.9}"
# 锁定版本：pi 的 find/grep 依赖这两个二进制；不要用 latest（sharkdp/fd 曾发过无 asset 的 release）
FD_VERSION="${FD_VERSION:-10.3.0}"
RG_VERSION="${RG_VERSION:-14.1.1}"
# pi-mcp-adapter >=2.21.1 把 sampling-handler.ts 换成了 `@earendil-works/pi-ai/compat` 子路径导出，
# 要求 peerDependency pi-ai@^0.84.1；而 PI_VERSION=0.79.9 绑定的 pi-ai 是 0.79.9（没有 /compat 导出），
# 装最新版会导致扩展加载时直接 MODULE_NOT_FOUND、pi 进程整体退出（Docker 生产环境同样受影响，
# 见 pi-runtime/Dockerfile 的对应修复）。锁定最后一个兼容版本，升级 PI_VERSION 到 >=0.84.1 时两边一起放开。
PI_MCP_ADAPTER_VERSION="${PI_MCP_ADAPTER_VERSION:-2.21.0}"

# 从 GitHub release 拉单个二进制到 OUT_DIR/bin（国内走 gh 加速前缀，失败再回官方）
download_github_binary() {
  local dest_name="$1"
  local github_url="$2"
  local archive_name="$3"
  local inner_binary="$4"
  local cache_path="$CACHE_DIR/$archive_name"
  local extract_dir="$CACHE_DIR/extract_${dest_name}"

  mkdir -p "$CACHE_DIR"
  if [[ ! -f "$cache_path" ]]; then
    local candidates=()
    if [[ -n "${GITHUB_MIRROR_PREFIX:-}" ]]; then
      candidates+=("${GITHUB_MIRROR_PREFIX}${github_url}")
    fi
    candidates+=(
      "https://ghfast.top/${github_url}"
      "https://mirror.ghproxy.com/${github_url}"
      "$github_url"
    )
    local ok=0
    local url
    for url in "${candidates[@]}"; do
      echo "    尝试: $url"
      if curl -fL --http1.1 --retry 3 --retry-delay 2 --connect-timeout 30 \
        --speed-time 60 --speed-limit 1024 \
        -o "$cache_path.partial" "$url" \
        && tar -tzf "$cache_path.partial" >/dev/null 2>&1; then
        mv "$cache_path.partial" "$cache_path"
        ok=1
        break
      fi
      rm -f "$cache_path.partial"
      echo "    失败，换源重试…"
    done
    if [[ "$ok" -ne 1 ]]; then
      echo "错误：无法下载 $archive_name。可手动放到 $cache_path 再重跑。" >&2
      echo "URL: $github_url" >&2
      exit 1
    fi
  else
    echo "    使用缓存: $cache_path"
  fi

  rm -rf "$extract_dir"
  mkdir -p "$extract_dir"
  tar -xzf "$cache_path" -C "$extract_dir"
  local found
  found="$(find "$extract_dir" -type f -name "$inner_binary" | head -n 1)"
  if [[ -z "$found" ]]; then
    echo "错误：压缩包内未找到 $inner_binary" >&2
    exit 1
  fi
  cp "$found" "$OUT_DIR/bin/$dest_name"
  chmod +x "$OUT_DIR/bin/$dest_name"
  if [[ "$(uname -s)" = "Darwin" ]]; then
    xattr -d com.apple.quarantine "$OUT_DIR/bin/$dest_name" 2>/dev/null || true
  fi
  rm -rf "$extract_dir"
}

echo "==> [1/5] 安装 @earendil-works/pi-coding-agent@${PI_VERSION}"
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR/bin" "$OUT_DIR/extensions"
cd "$OUT_DIR"
npm init -y >/dev/null
# 国内网络优先用 npmmirror，失败再回退官方源
npm install --omit=dev "@earendil-works/pi-coding-agent@${PI_VERSION}" \
  --registry "${NPM_CONFIG_REGISTRY:-https://registry.npmmirror.com}"

echo "==> [2/5] 写 bin/pi 包装脚本（用 NODE_BIN 跑 cli.js，Electron 桌面场景指向内置 Node）"
CLI_JS="node_modules/@earendil-works/pi-coding-agent/dist/cli.js"
if [[ ! -f "$OUT_DIR/$CLI_JS" ]]; then
  echo "错误：未找到 $OUT_DIR/$CLI_JS，pi 包结构可能已变更" >&2
  exit 1
fi
cat > "$OUT_DIR/bin/electron-node-shim.js" <<'EOF'
'use strict';
// Electron 内置 Node（ELECTRON_RUN_AS_NODE=1）精简过 worker_threads 实现，
// 缺失 markAsUncloneable（真实 Node >=21 才有，undici@8 的 webidl 模块直接 require 它，
// pi-coding-agent 依赖的 undici 一加载就崩：TypeError: webidl.util.markAsUncloneable is not a function）。
// pi CLI 是单进程 CLI，不会真的跨 worker structured-clone Cache/Response 对象，
// 打一个安全的空实现即可；真实 Node 环境下该函数已存在，下面判断直接跳过。
try {
  const workerThreads = require('node:worker_threads');
  if (typeof workerThreads.markAsUncloneable !== 'function') {
    workerThreads.markAsUncloneable = () => {};
  }
} catch (_err) {
  // require 失败也不影响主流程，交给后续真实报错暴露问题
}
EOF
cat > "$OUT_DIR/bin/pi" <<'EOF'
#!/bin/bash
# Electron 桌面场景由 process-manager 注入 NODE_BIN=Electron 可执行文件 + ELECTRON_RUN_AS_NODE=1；
# Docker / 本机开发未设置 NODE_BIN 时退回 PATH 里的 node（与容器行为一致）。
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE="${NODE_BIN:-node}"
# -r 预加载 electron-node-shim.js：补齐 Electron 内置 Node 精简掉的 worker_threads API
# （真实 node 已自带该 API，shim 里判断存在则跳过，不影响容器/本机开发场景）
exec "$NODE" -r "$ROOT/bin/electron-node-shim.js" "$ROOT/node_modules/@earendil-works/pi-coding-agent/dist/cli.js" "$@"
EOF
chmod +x "$OUT_DIR/bin/pi"

echo "==> [3/5] 安装 pi-mcp-adapter@${PI_MCP_ADAPTER_VERSION} 到 extensions/（版本锁定原因见上，等效 Dockerfile 里的 npm pack + 解压）"
TMP_DIR="$(mktemp -d)"
cd "$TMP_DIR"
npm pack "pi-mcp-adapter@${PI_MCP_ADAPTER_VERSION}" --registry "${NPM_CONFIG_REGISTRY:-https://registry.npmmirror.com}" >/dev/null
mkdir -p "$OUT_DIR/extensions/pi-mcp-adapter"
tar -xzf pi-mcp-adapter-*.tgz -C "$OUT_DIR/extensions/pi-mcp-adapter" --strip-components=1
cd "$OUT_DIR/extensions/pi-mcp-adapter"
npm install --omit=dev --registry "${NPM_CONFIG_REGISTRY:-https://registry.npmmirror.com}"
rm -rf "$TMP_DIR"

echo "==> [4/5] 拷贝 bwrap 扩展（路径白名单，macOS sandbox-exec 下同样启用）"
cp -R "$ROOT_DIR/pi-runtime/extensions/bwrap" "$OUT_DIR/extensions/bwrap"

echo "==> [5/5] 下载沙盒搜索工具 fd ${FD_VERSION} / rg ${RG_VERSION}（运行时沙盒禁网，不能靠 pi 自动下载）"
if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
  echo "错误：当前仅打包 darwin-arm64 的 fd/rg，请在 Apple Silicon Mac 上构建" >&2
  exit 1
fi
download_github_binary "fd" \
  "https://github.com/sharkdp/fd/releases/download/v${FD_VERSION}/fd-v${FD_VERSION}-aarch64-apple-darwin.tar.gz" \
  "fd-v${FD_VERSION}-aarch64-apple-darwin.tar.gz" \
  "fd"
download_github_binary "rg" \
  "https://github.com/BurntSushi/ripgrep/releases/download/${RG_VERSION}/ripgrep-${RG_VERSION}-aarch64-apple-darwin.tar.gz" \
  "ripgrep-${RG_VERSION}-aarch64-apple-darwin.tar.gz" \
  "rg"

echo "==> 完成：$OUT_DIR"
du -sh "$OUT_DIR"
ls -la "$OUT_DIR/bin" "$OUT_DIR/extensions"
