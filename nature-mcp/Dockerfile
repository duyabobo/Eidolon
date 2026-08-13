FROM python:3.12-slim

WORKDIR /app

RUN sed -i 's|http://deb.debian.org/debian|http://mirrors.tuna.tsinghua.edu.cn/debian|g' \
      /etc/apt/sources.list.d/debian.sources \
 && apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN pip config set global.index-url https://pypi.tuna.tsinghua.edu.cn/simple

COPY pi-shared /pi-shared
COPY nature-mcp /tmp/nature-mcp
RUN pip install --no-cache-dir /pi-shared /tmp/nature-mcp \
 && rm -rf /tmp/nature-mcp

COPY nature-mcp/entrypoint.py /app/entrypoint.py

ENV TRANSPORT=streamable-http \
    HOST=0.0.0.0 \
    PORT=8082 \
    ALLOWED_HOSTS=nature-mcp,nature-mcp:8082,localhost,localhost:8082,127.0.0.1,127.0.0.1:8082 \
    LOG_DIR=/app/logs \
    LOG_LEVEL=INFO

RUN mkdir -p /app/logs

EXPOSE 8082

HEALTHCHECK --interval=10s --timeout=5s --retries=8 --start-period=20s \
  CMD python -c "import os,socket; p=int(os.environ.get('PORT','8082')); s=socket.create_connection(('127.0.0.1',p),2); s.close()"

CMD ["python", "/app/entrypoint.py"]
