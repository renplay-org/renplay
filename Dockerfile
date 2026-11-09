# syntax=docker/dockerfile:1.7
FROM node:24-bookworm-slim AS build
WORKDIR /src

COPY selector/package.json selector/package-lock.json selector/
RUN cd selector && npm ci --no-audit --no-fund
COPY server/package.json server/package-lock.json server/
RUN cd server && npm ci --no-audit --no-fund

COPY selector/ selector/
# The library builds with the types and rules it shares with the server.
COPY server/src/shared/ server/src/shared/
RUN cd selector && npm run build
COPY server/ server/
RUN cd server && npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
# nginx serves the games volume; libarchive-tools (bsdtar) unpacks 7z/rar
# archives. Ren'Py engines come prebuilt from renplay-org/engines.
# jemalloc avoids glibc retaining fragmented sharp/libvips image allocations.
RUN apt-get update \
 && apt-get install -y --no-install-recommends nginx-light gettext-base libarchive-tools curl ca-certificates libjemalloc2 util-linux \
 && ln -s /usr/lib/*-linux-gnu/libjemalloc.so.2 /usr/local/lib/libjemalloc.so.2 \
 && rm -rf /var/lib/apt/lists/* /etc/nginx/sites-enabled /var/log/nginx \
 && mkdir -p /app

WORKDIR /app
COPY --from=build /src/selector/dist /app/web
COPY --from=build /src/server/dist /app/server/dist
COPY --from=build /src/server/node_modules /app/server/node_modules
COPY --from=build /src/server/package.json /app/server/package.json
COPY server/catalog.json /app/server/catalog.json
COPY runtime /app/runtime
# The image keeps its own files in /app/deploy, where they have always been.
COPY image/nginx.conf.template image/entrypoint.sh /app/deploy/
RUN chmod +x /app/deploy/entrypoint.sh

ENV NODE_ENV=production \
    LD_PRELOAD=/usr/local/lib/libjemalloc.so.2 \
    GAMES_DIR=/games \
    DATA_DIR=/data \
    HOME=/tmp/home \
    NODE_OPTIONS=--disable-warning=ExperimentalWarning \
    UV_THREADPOOL_SIZE=16

USER 1000:1000
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl --fail --silent --show-error http://127.0.0.1:8080/api/health || exit 1
ENTRYPOINT ["/app/deploy/entrypoint.sh"]
