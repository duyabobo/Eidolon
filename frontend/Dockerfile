FROM node:20-alpine AS builder

WORKDIR /app

# 国内 ECS 使用 npmmirror，避免 registry.npmjs.org 过慢/超时
ENV NPM_CONFIG_REGISTRY=https://registry.npmmirror.com

COPY package.json .
RUN npm install
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 3000
