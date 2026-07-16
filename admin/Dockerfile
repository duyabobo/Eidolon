FROM python:3.12-slim

WORKDIR /app

# trixie 使用 DEB822（debian.sources），改 sources.list 无效
RUN sed -i 's|http://deb.debian.org/debian|https://mirrors.tuna.tsinghua.edu.cn/debian|g' \
      /etc/apt/sources.list.d/debian.sources \
 && apt-get update && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/*

COPY pi-shared /pi-shared
RUN pip install --no-cache-dir /pi-shared

COPY admin/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY admin/ .

EXPOSE 9000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "9000", "--no-access-log"]
