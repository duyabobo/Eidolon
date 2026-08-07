FROM python:3.12-slim

WORKDIR /app

# slim 镜像尚无 ca-certificates，必须用 http 换源；运行时访问 arXiv/S2 需要证书
RUN sed -i 's|http://deb.debian.org/debian|http://mirrors.tuna.tsinghua.edu.cn/debian|g' \
      /etc/apt/sources.list.d/debian.sources \
 && apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN pip config set global.index-url https://pypi.tuna.tsinghua.edu.cn/simple

# 与其它 Python 服务一致：复用 pi_shared 日志（按天切割、保留 7 天）
COPY pi-shared /pi-shared
RUN pip install --no-cache-dir /pi-shared 'arxiv-mcp-server[pdf]'

COPY arxiv-mcp/entrypoint.py /app/entrypoint.py

ENV TRANSPORT=http \
    HOST=0.0.0.0 \
    PORT=8081 \
    ALLOWED_HOSTS=arxiv-mcp,arxiv-mcp:8081,localhost,localhost:8081,127.0.0.1,127.0.0.1:8081 \
    LOG_DIR=/app/logs \
    LOG_LEVEL=INFO

RUN mkdir -p /data/arxiv-papers /app/logs

EXPOSE 8081

# 官方无独立 /health；探测本机端口是否在听
HEALTHCHECK --interval=10s --timeout=5s --retries=8 --start-period=20s \
  CMD python -c "import os,socket; p=int(os.environ.get('PORT','8081')); s=socket.create_connection(('127.0.0.1',p),2); s.close()"

CMD ["python", "/app/entrypoint.py", "--storage-path", "/data/arxiv-papers"]
