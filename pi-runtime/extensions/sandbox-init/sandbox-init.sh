#!/bin/bash
#
# 沙盒启动脚本：初始化网络环境，启动 TCP→Unix socket 桥，然后 exec pi。
# Linux（bwrap --unshare-net）与 macOS（sandbox-exec）共用同一脚本。
#
# 调用方式：sandbox-init.sh <pi-command> [pi-args...]
#   <pi-command> 可以是裸命令 "pi"（容器 PATH 里有全局安装），也可以是安装包内
#   绝对路径（Electron 桌面场景由 pi-session.ts 传入 build/pi-cli/bin/pi）。
#
# 步骤：
#   1. Linux 下启用 loopback 接口（--unshare-net 新建的网络命名空间默认 lo 是 DOWN；
#      macOS sandbox-exec 没有网络命名空间，lo 始终是 UP，且没有 ip 命令，跳过）
#   2. 启动 bridge.js（将 loopback TCP 端口桥接到挂载/落地的 Unix socket）
#   3. exec pi（替换当前进程，stdin/stdout 透传给 pi-session.ts）

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# Electron 桌面场景由 process-manager 注入 NODE_BIN=Electron 可执行文件；
# 容器未设置时退回 PATH 里的 node。
NODE="${NODE_BIN:-node}"

if [ "$(uname)" = "Linux" ]; then
  # 启用 loopback（--unshare-net 创建的新 netns 中 lo 默认是 DOWN）
  ip link set lo up
fi

# 启动网络桥（后台运行，输出到 stderr）
# 用脚本同目录相对路径定位 bridge.js，不再硬编码 /app/...（Docker WORKDIR 巧合路径，
# Electron 打包后 pi-runtime 落在 Resources/pi-runtime，绝对路径对不上）。
"$NODE" "$SCRIPT_DIR/bridge.js" &
BRIDGE_PID=$!

# 给桥一点时间监听就绪（bridge.js 启动极快，0.1s 足够）
sleep 0.1

# exec 替换当前进程，stdin/stdout 直接连接到 pi
exec "$@"
