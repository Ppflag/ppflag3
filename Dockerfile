# 标准 Node.js 运行镜像；如果 CloudBase 拉取 Docker Hub 失败，
# 可改成：FROM docker.m.daocloud.io/library/node:20-alpine
FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production
# 腾讯云 CloudBase 云托管默认把流量转到容器 80 端口
ENV PORT=80

# 先装依赖，利用 Docker 层缓存
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

# 再复制运行代码和静态页面
COPY server.js ./
COPY auth.js ./
COPY public ./public

EXPOSE 80

# 用 npm start 启动，package.json 里是 node server.js
CMD ["npm", "start"]
