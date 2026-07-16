FROM python:3.12-slim

WORKDIR /app

# trixie 使用 DEB822（debian.sources），改 sources.list 无效
# slim 镜像尚无 ca-certificates，必须用 http，不能用 https
RUN sed -i 's|http://deb.debian.org/debian|http://mirrors.tuna.tsinghua.edu.cn/debian|g' \
      /etc/apt/sources.list.d/debian.sources \
 && apt-get update && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/*

# 容器内 pip 切换清华源（一次配置，后续 install 均生效）
RUN pip config set global.index-url https://pypi.tuna.tsinghua.edu.cn/simple

COPY pi-shared /pi-shared
RUN pip install --no-cache-dir /pi-shared

COPY mcp-proxy/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY mcp-proxy/ .

ENV NODE_ENV=production

HEALTHCHECK --interval=10s --timeout=5s --retries=5 \
  CMD curl -f http://127.0.0.1:${MCP_PROXY_PORT:-8080}/health || exit 1

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${MCP_PROXY_PORT:-8080} --no-access-log"]
