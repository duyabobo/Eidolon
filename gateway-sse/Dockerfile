FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

# 先安装共享包，利用 Docker layer 缓存
COPY pi-shared /pi-shared
RUN pip install --no-cache-dir /pi-shared

COPY gateway-sse/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY gateway-sse/ .

EXPOSE 8001

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001", "--no-access-log"]
