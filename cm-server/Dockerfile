FROM python:3.12-slim

WORKDIR /app

# trixie 使用 DEB822（debian.sources），改 sources.list 无效
# slim 默认无 ca-certificates：apt 换源用 http；pip 走 https 清华源必须装证书，否则易 SSL EOF / 半截 JSON
RUN sed -i 's|http://deb.debian.org/debian|http://mirrors.tuna.tsinghua.edu.cn/debian|g' \
      /etc/apt/sources.list.d/debian.sources \
 && apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# 容器内 pip 切换清华源；retries 缓解镜像偶发断流
RUN pip config set global.index-url https://pypi.tuna.tsinghua.edu.cn/simple \
 && pip config set global.retries 5 \
 && pip config set global.trusted-host pypi.tuna.tsinghua.edu.cn

# 先安装共享包，利用 Docker layer 缓存
COPY pi-shared /pi-shared
RUN pip install --no-cache-dir /pi-shared

COPY cm-server/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY cm-server/cm_server ./cm_server

EXPOSE 8000

CMD ["sh", "-c", "uvicorn cm_server.main:app --host 0.0.0.0 --port ${CM_SERVER_PORT:-8000} --no-access-log"]
