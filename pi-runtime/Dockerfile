FROM node:24-bookworm-slim

# 安装系统工具：
#   bwrap       沙盒核心
#   iproute2    提供 ip 命令（沙盒启动脚本用 ip link set lo up 启用 loopback）
#   python3     沙盒内 Python 环境
#   ripgrep     pi 依赖
# Acquire::Retries 应对 deb.debian.org 偶发 502；外层循环应对 update/install 整段失败
# bookworm 使用 DEB822（debian.sources），国内 ECS 换清华源
RUN set -eux; \
    # slim 镜像尚无 ca-certificates，必须用 http，不能用 https
    sed -i 's|http://deb.debian.org/debian|http://mirrors.tuna.tsinghua.edu.cn/debian|g' \
      /etc/apt/sources.list.d/debian.sources; \
    apt_pkgs="bash bubblewrap ca-certificates curl git iproute2 python3 python3-pip python3-venv ripgrep"; \
    apt_opts="-o Acquire::Retries=5 -o Acquire::http::Timeout=120"; \
    for attempt in 1 2 3 4 5; do \
      if apt-get ${apt_opts} update \
        && apt-get ${apt_opts} install -y --no-install-recommends ${apt_pkgs}; then \
        break; \
      fi; \
      if [ "$attempt" -eq 5 ]; then exit 1; fi; \
      echo "apt failed (attempt ${attempt}), retry in 15s..."; \
      sleep 15; \
    done; \
    rm -rf /var/lib/apt/lists/*

# 国内 ECS 使用 npmmirror，避免 registry.npmjs.org 过慢/超时
ENV NPM_CONFIG_REGISTRY=https://registry.npmmirror.com

# 全局安装 pi coding agent（锁定版本，升级前先在测试环境验证扩展兼容性）
# 升级步骤：1.改版本号 2.本地 build 测试 3.确认 bwrap 扩展正常工作 4.部署
ARG PI_VERSION=0.79.9
RUN npm install -g --ignore-scripts @earendil-works/pi-coding-agent@${PI_VERSION}

# 安装 pi-mcp-adapter 插件（pi 调用 MCP 服务的唯一社区适配器）
# 等效于交互式环境下执行 `pi install npm:pi-mcp-adapter`
# 原理：npm pack 下载 tarball → 解压到 pi extensions 目录 → 安装依赖（含 @modelcontextprotocol/ext-apps）
#
# 锁定版本，不能装最新版：pi-mcp-adapter>=2.21.1 的 sampling-handler.ts 改成从
# `@earendil-works/pi-ai/compat` 这个子路径导入，要求 peerDependency pi-ai@^0.84.1；
# 而 PI_VERSION=0.79.9 绑定的 @earendil-works/pi-ai 是 0.79.9（没有 /compat 导出）。
# 装了不兼容版本会导致 pi-mcp-adapter 扩展加载时 MODULE_NOT_FOUND，pi 进程直接崩溃退出，
# 所有依赖 MCP 工具调用的会话都会失败。2.21.0 是兼容 pi-ai@0.79.9 的最后一个版本；
# 升级 PI_VERSION 到 >=0.84.1 时，两个版本号要一起放开重新验证。
ARG PI_MCP_ADAPTER_VERSION=2.21.0
RUN mkdir -p /root/.pi/agent/extensions && \
    cd /tmp && \
    npm pack pi-mcp-adapter@${PI_MCP_ADAPTER_VERSION} && \
    mkdir -p /root/.pi/agent/extensions/pi-mcp-adapter && \
    tar -xzf pi-mcp-adapter-*.tgz \
        -C /root/.pi/agent/extensions/pi-mcp-adapter \
        --strip-components=1 && \
    rm /tmp/pi-mcp-adapter-*.tgz && \
    cd /root/.pi/agent/extensions/pi-mcp-adapter && \
    npm install --omit=dev

WORKDIR /app

# 先安装 worker 依赖（含 devDependencies 用于编译 TypeScript）
COPY package.json .
RUN npm install

# 复制源码并编译 TypeScript
COPY tsconfig.json .
COPY src ./src
RUN npm run build

# 复制扩展目录（bwrap extension、sandbox-init）
COPY extensions ./extensions

# 将 bwrap 扩展注册到 pi 默认扩展路径（PI_CODING_AGENT_DIR 指向 session 独立目录，
# session 目录内的 extensions 软链接回此处）
RUN mkdir -p /root/.pi/agent/extensions && \
    cp -r extensions/bwrap /root/.pi/agent/extensions/bwrap && \
    chmod +x extensions/sandbox-init/sandbox-init.sh

# 清理 devDependencies（编译完成后不再需要）
RUN npm prune --omit=dev

# 沙盒临时目录
RUN mkdir -p /tmp/pi-sandbox

ENV NODE_ENV=production
ENV SANDBOX_ROOT=/tmp/pi-sandbox

CMD ["node", "dist/worker.js"]
