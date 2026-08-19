#!/usr/bin/env bash
# CM 桌面架构 · 本机部署 / 打包脚本
# 用法（需 bash，不要用 sh deploy.sh）：
#   bash deploy.sh              # Docker：构建镜像 + 启动（打包前本机调试）
#   bash deploy.sh --no-build   # Docker：跳过镜像构建，直接用已有镜像启动
#   bash deploy.sh --package    # 打 mac arm64 桌面安装包（.dmg，无需 Docker）
#   bash deploy.sh --down       # 停止并移除所有容器（保留数据卷）
#   bash deploy.sh --clean      # 停止并移除容器 + 数据卷（谨慎：会清空用户 workspace）
#
# 注：CM 架构改造后 gateway/gateway-sse/admin/llm-proxy/mcp-proxy 已合并为单进程
# cm-server（见 cm-server/README.md），pi-runtime 基于本机内存态调度单实例 session，
# 均不支持多实例水平扩展，--prod/--scale 相关参数已移除。

# 若用 sh deploy.sh 调用，dash 不支持 pipefail 等 bash 语法，自动切到 bash
if [ -z "${BASH_VERSION:-}" ]; then
  exec bash "$0" "$@"
fi

set -euo pipefail

# ── 颜色输出 ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

# ── 解析参数 ─────────────────────────────────────────────────────────────────────
MODE="dev"
COMPOSE_FILES="-f docker-compose.yml"
NO_BUILD=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --no-build) NO_BUILD=true; shift ;;
    --package)  MODE="package"; shift ;;
    --down)     MODE="down"; shift ;;
    --clean)    MODE="clean"; shift ;;
    *) error "未知参数: $1（支持 --package / --no-build / --down / --clean）" ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── 前置检查 ─────────────────────────────────────────────────────────────────────
check_prerequisites() {
  info "检查前置依赖..."
  command -v docker   &>/dev/null || error "未找到 docker，请先安装 Docker"
  command -v docker compose &>/dev/null || \
    docker compose version &>/dev/null  || error "未找到 docker compose，请升级 Docker"

  # 检查 Docker daemon 是否可用
  if ! docker ps &>/dev/null; then
    error "Docker daemon 未运行或无权限访问，请先启动 Docker Desktop"
  fi

  success "前置依赖检查通过"
}

# ── 环境变量初始化 ───────────────────────────────────────────────────────────────
setup_env() {
  if [[ ! -f .env ]]; then
    cp .env.example .env
    info ".env 不存在，已从 .env.example 自动创建"
  fi

  # shellcheck source=/dev/null
  source .env

  success "环境变量检查通过"
}

# ── 停止 ────────────────────────────────────────────────────────────────────────
do_down() {
  info "停止所有容器..."
  # shellcheck disable=SC2086
  docker compose $COMPOSE_FILES down
  success "所有容器已停止（数据卷保留）"
}

do_clean() {
  warn "即将删除所有容器和数据卷（包含用户 workspace 数据），5 秒后继续，Ctrl+C 取消..."
  sleep 5
  # shellcheck disable=SC2086
  docker compose $COMPOSE_FILES down -v
  success "所有容器和数据卷已清理"
}

# ── 构建 ────────────────────────────────────────────────────────────────────────
do_build() {
  info "构建服务镜像..."
  # shellcheck disable=SC2086
  docker compose $COMPOSE_FILES build --parallel
  success "镜像构建完成"
}

# ── 启动 ────────────────────────────────────────────────────────────────────────
do_start() {
  info "启动所有服务..."
  # shellcheck disable=SC2086
  docker compose $COMPOSE_FILES up -d --remove-orphans
  success "容器已启动"
}

# ── mac arm64 桌面安装包 ─────────────────────────────────────────────────────────
do_package() {
  # 不依赖 Docker：直接复用 scripts/package-mac.sh（frontend/pi-runtime/pi-cli/cm-server + dmg）
  [[ -f "$SCRIPT_DIR/scripts/package-mac.sh" ]] || \
    error "缺少 scripts/package-mac.sh，无法打包"
  info "开始打 mac arm64 桌面安装包（.dmg）..."
  bash "$SCRIPT_DIR/scripts/package-mac.sh"
}

# ── 等待健康检查 ─────────────────────────────────────────────────────────────────
wait_healthy() {
  local services=("cm-server" "pi-runtime" "frontend")
  local timeout=120
  local interval=5

  info "等待服务就绪（最多 ${timeout}s）..."
  for svc in "${services[@]}"; do
    local elapsed=0
    while true; do
      local state
      state=$(docker compose $COMPOSE_FILES ps -q "$svc" 2>/dev/null | \
              xargs -r docker inspect --format='{{.State.Health.Status}}' 2>/dev/null || echo "unknown")

      if [[ "$state" == "healthy" ]]; then
        success "$svc 就绪"
        break
      fi

      if (( elapsed >= timeout )); then
        error "$svc 在 ${timeout}s 内未就绪，当前状态: $state"
      fi

      sleep "$interval"
      (( elapsed += interval ))
    done
  done
}

# ── 输出访问信息 ─────────────────────────────────────────────────────────────────
print_summary() {
  echo ""
  echo "═══════════════════════════════════════════"
  echo "  Pi Agent Platform 部署完成（CM 单机架构）"
  echo "═══════════════════════════════════════════"
  echo ""
  echo "  服务地址："
  echo "    前端        →  http://localhost:3000"
  echo "    CM Server   →  http://localhost:8000  （合并自 gateway/gateway-sse/admin/llm-proxy/mcp-proxy）"
  echo ""
  echo "  API 示例："
  echo "    # 创建会话（turn_id 由前端生成，用于 SSE 订阅）"
  echo "    curl -X POST http://localhost:8000/sessions \\"
  echo "      -H 'Content-Type: application/json' \\"
  echo "      -d '{\"user_id\": \"alice\", \"request\": \"帮我写一个 hello world\", \"turn_id\": \"turn-1\"}'"
  echo ""
  echo "    # 拉取 SSE 流（替换 SESSION_ID/TURN_ID）"
  echo "    curl -N http://localhost:8000/sessions/SESSION_ID/turns/TURN_ID/stream"
  echo ""
  echo "  查看日志："
  echo "    docker compose logs -f cm-server"
  echo "    docker compose logs -f pi-runtime"
  echo ""
  echo "  打桌面安装包："
  echo "    bash deploy.sh --package"
  echo ""
}

# ── 主流程 ───────────────────────────────────────────────────────────────────────
main() {
  echo ""
  info "Pi Agent Platform 部署脚本"
  echo ""

  case "$MODE" in
    down)    check_prerequisites; do_down; exit 0 ;;
    clean)   check_prerequisites; do_clean; exit 0 ;;
    package) do_package; exit 0 ;;
  esac

  check_prerequisites
  setup_env
  if [[ "$NO_BUILD" == "true" ]]; then
    info "跳过镜像构建（--no-build），使用已有镜像"
  else
    do_build
  fi
  do_start
  wait_healthy
  print_summary
}

main
