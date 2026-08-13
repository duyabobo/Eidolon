#!/usr/bin/env bash
# 为 mac arm64 桌面安装包构建内置沙盒 Python（python-build-standalone + 科学栈）。
# 产物：build/sandbox-python/（含 bin/python3 与 site-packages）
#
# 用法：bash scripts/build-sandbox-python.sh
# 强制重建：FORCE_REBUILD=1 bash scripts/build-sandbox-python.sh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT_DIR/build/sandbox-python"
CACHE_DIR="$ROOT_DIR/build/cache"
REQ_FILE="$ROOT_DIR/pi-runtime/sandbox-python-requirements.txt"
MARKER="$OUT_DIR/.eidolon-sandbox-python-ready"

# 锁定版本：升级前在 arm64 Mac 上验证科学包可 import
PBS_TAG="${PBS_TAG:-20251202}"
CPYTHON_VERSION="${CPYTHON_VERSION:-3.12.12}"
ARCH_TRIPLE="aarch64-apple-darwin"
TARBALL="cpython-${CPYTHON_VERSION}+${PBS_TAG}-${ARCH_TRIPLE}-install_only_stripped.tar.gz"
GITHUB_URL="https://github.com/astral-sh/python-build-standalone/releases/download/${PBS_TAG}/${TARBALL}"

if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
  echo "错误：sandbox-python 目前仅支持在 Apple Silicon Mac 上构建" >&2
  exit 1
fi

if [[ -f "$MARKER" && "${FORCE_REBUILD:-0}" != "1" ]]; then
  echo "==> 已存在 ${OUT_DIR} (跳过; 强制重建: FORCE_REBUILD=1)"
  cat "$MARKER"
  exit 0
fi

mkdir -p "$CACHE_DIR"
TARBALL_PATH="$CACHE_DIR/$TARBALL"

download_tarball() {
  local url="$1"
  echo "    尝试: $url"
  # GitHub HTTP/2 在部分网络下会 PROTOCOL_ERROR，强制 HTTP/1.1 更稳
  curl -fL --http1.1 --retry 3 --retry-delay 2 --connect-timeout 30 \
    --speed-time 60 --speed-limit 1024 \
    -o "$TARBALL_PATH.partial" "$url" || return 1
  # 校验 tar 头，避免半截文件被当成缓存
  if ! tar -tzf "$TARBALL_PATH.partial" >/dev/null 2>&1; then
    echo "    下载文件损坏（非有效 tar.gz）" >&2
    rm -f "$TARBALL_PATH.partial"
    return 1
  fi
  mv "$TARBALL_PATH.partial" "$TARBALL_PATH"
}

echo "==> [1/4] 下载便携 CPython ${CPYTHON_VERSION} (${PBS_TAG})"
if [[ ! -f "$TARBALL_PATH" ]]; then
  # 优先官方；失败则走常见 gh 加速前缀（也可用 PBS_MIRROR_PREFIX 自定义）
  CANDIDATES=()
  if [[ -n "${PBS_MIRROR_PREFIX:-}" ]]; then
    CANDIDATES+=("${PBS_MIRROR_PREFIX}${GITHUB_URL}")
  fi
  # 国内默认优先镜像（官方 GitHub 经常超时）
  CANDIDATES+=(
    "https://ghfast.top/${GITHUB_URL}"
    "https://mirror.ghproxy.com/${GITHUB_URL}"
    "$GITHUB_URL"
  )
  ok=0
  for url in "${CANDIDATES[@]}"; do
    if download_tarball "$url"; then
      ok=1
      break
    fi
    rm -f "$TARBALL_PATH.partial"
    echo "    失败，换源重试…"
  done
  if [[ "$ok" -ne 1 ]]; then
    echo "错误：无法下载 $TARBALL。可手动下载后放到 $TARBALL_PATH 再重跑。" >&2
    echo "URL: $GITHUB_URL" >&2
    exit 1
  fi
else
  echo "    使用缓存: $TARBALL_PATH"
fi

echo "==> [2/4] 解压到 ${OUT_DIR}"
rm -rf "${OUT_DIR}"
mkdir -p "${OUT_DIR}"
# install_only_stripped 顶层通常为 python/
TMP_EXTRACT="$CACHE_DIR/sandbox-python-extract-$$"
rm -rf "$TMP_EXTRACT"
mkdir -p "$TMP_EXTRACT"
tar -xzf "$TARBALL_PATH" -C "$TMP_EXTRACT"
if [[ -d "$TMP_EXTRACT/python" ]]; then
  # 把 python/ 内容提到 OUT_DIR 根，便于 Resources/sandbox-python/bin/python3
  shopt -s dotglob
  mv "$TMP_EXTRACT/python"/* "${OUT_DIR}/"
  shopt -u dotglob
else
  shopt -s dotglob
  mv "$TMP_EXTRACT"/* "${OUT_DIR}/"
  shopt -u dotglob
fi
rm -rf "$TMP_EXTRACT"

PYTHON_BIN="${OUT_DIR}/bin/python3"
[[ -x "$PYTHON_BIN" ]] || { echo "错误：未找到 ${PYTHON_BIN}" >&2; exit 1; }

# 保证 python / python3 都可用
if [[ ! -e "${OUT_DIR}/bin/python" ]]; then
  ln -sf python3 "${OUT_DIR}/bin/python"
fi

echo "==> [3/4] pip 安装科学栈"
"$PYTHON_BIN" -m pip install --upgrade pip -q
"$PYTHON_BIN" -m pip install -r "$REQ_FILE" \
  -i "${PIP_INDEX_URL:-https://pypi.tuna.tsinghua.edu.cn/simple}" \
  --trusted-host "${PIP_TRUSTED_HOST:-pypi.tuna.tsinghua.edu.cn}" \
  -q

echo "==> [4/4] 校验 import"
"$PYTHON_BIN" - <<'PY'
import numpy, pandas, scipy, matplotlib, sklearn, openpyxl, sympy, seaborn, requests, PIL
print("sandbox-python scientific stack ok")
print("python:", __import__("sys").executable)
PY

{
  echo "pbs_tag=${PBS_TAG}"
  echo "cpython=${CPYTHON_VERSION}"
  echo "built_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
} > "$MARKER"

SIZE_MB=$(du -sm "${OUT_DIR}" | awk '{print $1}')
echo "==> 完成: ${OUT_DIR} (约 ${SIZE_MB} MB)"
echo "打包时由 electron extraResources 打入 Resources/sandbox-python/"
