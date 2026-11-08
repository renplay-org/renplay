# The public demo at demo.renplay.org: Renplay with free games installed, their recipes in Your
# recipes, adult games blurred, and RENPLAY_DEMO on. Everything is in the image: a host that starts
# it fresh (Render's free plan, after 15 idle minutes or the demo's 4-hour stop) resets the demo.
#
#   sh deploy/demo/build-games.sh 8.5.3 deploy/demo/games
#   docker build -f deploy/demo/Dockerfile --build-arg IMAGE=ghcr.io/renplay-org/renplay:4.3.1 deploy/demo
ARG IMAGE=ghcr.io/renplay-org/renplay:latest

FROM ${IMAGE} AS seed
USER 0:0
RUN mkdir -p /data/recipes /games/_archives && chown -R 1000:1000 /data /games
USER 1000:1000
COPY --chown=1000:1000 recipes/ /data/recipes/
COPY --chown=1000:1000 games/ /games/_archives/
COPY seed.mjs /tmp/seed.mjs
ENV RENPLAY_ADULT_GAMES=blurred \
    RENPLAY_BACKUP_DIR=off \
    RENPLAY_RUNTIME_PATH=/app/runtime/renplay-runtime.js
RUN cd /games/_archives && node /tmp/seed.mjs *.zip

FROM ${IMAGE}
COPY --from=seed --chown=1000:1000 /data /data
COPY --from=seed --chown=1000:1000 /games /games
COPY --chmod=755 start.sh /app/deploy/demo-start.sh
ENV RENPLAY_DEMO=on \
    RENPLAY_ADULT_GAMES=blurred \
    RENPLAY_BACKUP_DIR=off
ENTRYPOINT ["/app/deploy/demo-start.sh"]
