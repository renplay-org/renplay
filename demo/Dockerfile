# The public demo at demo.renplay.org: Renplay with free games installed, their recipes in Your
# recipes, adult games off, and RENPLAY_DEMO on. Everything is in the image, so every start
# from it (after the demo's 4-hour stop, for one) is a fresh demo.
#
#   sh demo/build-games.sh 8.5.3 demo/games
#   docker build --build-arg IMAGE=ghcr.io/renplay-org/renplay:<version> demo
ARG IMAGE=ghcr.io/renplay-org/renplay:latest

FROM ${IMAGE} AS seed
USER 0:0
RUN mkdir -p /data/recipes /games/_archives && chown -R 1000:1000 /data /games
USER 1000:1000
COPY --chown=1000:1000 recipes/ /data/recipes/
COPY --chown=1000:1000 games/ /games/_archives/
COPY seed.mjs /tmp/seed.mjs
ENV RENPLAY_ADULT_GAMES=off \
    RENPLAY_BACKUP_DIR=off
RUN cd /games/_archives && node /tmp/seed.mjs *.zip

# The built games of the seed stage alone: the static demo (static/) takes the files of their builds from here, as
#   docker buildx build --build-arg IMAGE=<the demo's image> --target games --output type=local,dest=<dir> demo
FROM scratch AS games
COPY --from=seed /games /games

FROM ${IMAGE}
# One nginx worker, whatever cores the host shows. Each visitor's own address comes from the
# CF-Connecting-IP header: nginx takes it and logs it, and Renplay trusts nginx alone
# (RENPLAY_TRUSTED_HOPS=1 below), so the sign-in limit counts every visitor on their own.
USER 0:0
RUN sed -i -e 's/^worker_processes auto;/worker_processes 1;/' \
      -e 's|^  include /etc/nginx/mime.types;|&\n  real_ip_header CF-Connecting-IP;\n  set_real_ip_from 0.0.0.0/0;\n  set_real_ip_from ::/0;|' \
      -e 's|, from $log_client|, from $remote_addr|' \
      /app/deploy/nginx.conf.template \
 && grep -q '^worker_processes 1;' /app/deploy/nginx.conf.template \
 && grep -q '^  real_ip_header CF-Connecting-IP;' /app/deploy/nginx.conf.template \
 && grep -q ', from $remote_addr' /app/deploy/nginx.conf.template
# The demo is for trying, not for search results: every answer says noindex, and robots.txt lets crawlers in to read it
# (a blocked page never shows its noindex). The library page gets the title and description of the static demo (static/seo.mjs).
RUN sed -i 's|^\( *\)add_header X-Content-Type-Options "nosniff" always;|&\n\1add_header X-Robots-Tag "noindex" always;|' /app/deploy/nginx.conf.template \
 && [ "$(grep -c 'add_header X-Robots-Tag "noindex" always;' /app/deploy/nginx.conf.template)" = "$(grep -c 'add_header X-Content-Type-Options' /app/deploy/nginx.conf.template)" ] \
 && printf 'User-agent: *\nAllow: /\n' > /app/web/robots.txt \
 && sed -i 's|<title>Renplay</title>|<title>Renplay demo</title><meta name="description" content="Try Renplay, the self-hosted Ren’Py player, in your browser. Play a free sample game." /><meta name="robots" content="noindex" />|' /app/web/index.html \
 && grep -q '<title>Renplay demo</title>' /app/web/index.html
USER 1000:1000
COPY --from=seed --chown=1000:1000 /data /data
COPY --from=seed --chown=1000:1000 /games /games
COPY --chmod=755 start.sh /app/deploy/demo-start.sh
ENV RENPLAY_DEMO=on \
    RENPLAY_ADULT_GAMES=off \
    RENPLAY_BACKUP_DIR=off \
    RENPLAY_SAVE_HISTORY=3 \
    RENPLAY_TRUSTED_HOPS=1 \
    UV_THREADPOOL_SIZE=4
ENTRYPOINT ["/app/deploy/demo-start.sh"]
