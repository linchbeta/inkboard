# InkBoard backend image. On the NAS, in this folder:  docker compose up -d --build
#
# Build arguments (set in docker-compose.yml, or `docker build --build-arg ...`):
#   NODE_IMAGE    base image; a mirror if Docker Hub is slow, e.g.
#                 docker.m.daocloud.io/library/node:24-slim
#   NPM_REGISTRY  npm registry; e.g. https://registry.npmmirror.com in mainland China
ARG NODE_IMAGE=node:24-slim

FROM ${NODE_IMAGE} AS build
ARG NPM_REGISTRY=https://registry.npmjs.org
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --registry="$NPM_REGISTRY"
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM ${NODE_IMAGE}
ARG NPM_REGISTRY=https://registry.npmjs.org
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    TZ=Asia/Shanghai
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --registry="$NPM_REGISTRY" && npm cache clean --force
COPY --from=build /app/dist ./dist
# fonts and holiday schedules (the Microsoft comparison fonts are excluded, .dockerignore)
COPY assets ./assets
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=60s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/server.js"]
