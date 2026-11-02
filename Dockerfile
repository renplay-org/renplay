# syntax=docker/dockerfile:1.7
FROM node:24-bookworm-slim AS build
WORKDIR /src

COPY selector/package.json selector/package-lock.json selector/
RUN cd selector && npm ci --no-audit --no-fund
COPY server/package.json server/package-lock.json server/
RUN cd server && npm ci --no-audit --no-fund

COPY selector/ selector/
RUN cd selector && npm run build
COPY server/ server/
RUN cd server && npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
# nginx serves the games volume; libarchive-tools (bsdtar) unpacks 7z/rar
# archives. Ren'Py engines come prebuilt from renplay-web/engines.
RUN apt-get update \
 && apt-get install -y --no-install-recommends nginx-light gettext-base libarchive-tools curl ca-certificates \
 && rm -rf /var/lib/apt/lists/* /etc/nginx/sites-enabled /var/log/nginx \
 && mkdir -p /app

WORKDIR /app
COPY --from=build /src/selector/dist /app/web
COPY --from=build /src/server/dist /app/server/dist
COPY --from=build /src/server/node_modules /app/server/node_modules
COPY --from=build /src/server/package.json /app/server/package.json
COPY server/catalog.json /app/server/catalog.json
COPY runtime /app/runtime
COPY deploy/nginx.conf.template deploy/entrypoint.sh /app/deploy/
RUN chmod +x /app/deploy/entrypoint.sh

ENV NODE_ENV=production \
    GAMES_DIR=/games \
    DATA_DIR=/data \
    HOME=/tmp/home \
    NODE_OPTIONS=--disable-warning=ExperimentalWarning \
    UV_THREADPOOL_SIZE=16

USER 1000:1000
EXPOSE 8080
ENTRYPOINT ["/app/deploy/entrypoint.sh"]
