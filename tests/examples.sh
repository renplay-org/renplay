#!/bin/sh
# The files in deploy/ are what people copy to run Renplay: each one must be valid as it is.
set -eu
cd "$(dirname "$0")/.."

docker compose -f deploy/compose.yaml config --quiet
docker compose -f deploy/caddy/compose.yaml config --quiet
docker run --rm -v "$PWD/deploy/caddy/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2.11 \
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

# nginx checks its certificate files and its upstream's name: a throwaway certificate, and
# "renplay" pointing at the container itself.
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=renplay.example.com \
  -keyout "$tmp/privkey.pem" -out "$tmp/fullchain.pem" 2> /dev/null
chmod 644 "$tmp/privkey.pem"
docker run --rm --add-host renplay:127.0.0.1 \
  -v "$PWD/deploy/nginx/renplay.conf:/etc/nginx/conf.d/renplay.conf:ro" -v "$tmp:/etc/ssl/renplay:ro" \
  nginx:stable-alpine nginx -t -q

helm template renplay charts/renplay -f deploy/kubernetes/values.yaml > /dev/null
template=$(sed -n 's/.*app-template --version \([0-9.]*\).*/\1/p' deploy/kubernetes/app-template.yaml)
helm template renplay oci://ghcr.io/bjw-s-labs/helm/app-template --version "$template" \
  -f deploy/kubernetes/app-template.yaml > /dev/null
echo "The deploy/ examples are valid."
