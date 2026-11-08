#!/bin/sh
# deploy/compose.yaml, as the docs tell people to use it, starts the given image and writes its data.
#
#   sh tests/compose.sh renplay:dev
set -eu
image=$1
root=$(cd "$(dirname "$0")/.." && pwd)
dir=$(mktemp -d)
project=renplay-compose-test
cleanup() {
  docker compose -p "$project" --project-directory "$dir" down --volumes > /dev/null 2>&1 || true
  docker run --rm -v "$dir:/w" busybox rm -rf /w/games /w/data
  rm -rf "$dir"
}
trap cleanup EXIT

cp "$root/deploy/compose.yaml" "$dir/compose.yaml"
# The image under test, on a free port, under its own name.
cat > "$dir/compose.override.yaml" <<YAML
services:
  renplay:
    image: $image
    container_name: $project
    ports: !override
      - "18080:8080"
YAML
mkdir -p "$dir/games" "$dir/data"
docker run --rm -v "$dir:/w" busybox chown 1000:1000 /w/games /w/data

docker compose -p "$project" --project-directory "$dir" up -d --quiet-pull
for _ in $(seq 1 60); do
  curl -fs -o /dev/null http://127.0.0.1:18080/api/health && break
  sleep 2
done
curl -fsS http://127.0.0.1:18080/api/health
echo
docker run --rm -v "$dir/data:/data:ro" busybox find /data -maxdepth 1 -name '*.db' | grep -q . || {
  echo "Renplay started from deploy/compose.yaml but wrote no database to ./data"
  docker compose -p "$project" --project-directory "$dir" logs
  exit 1
}
echo "deploy/compose.yaml starts $image and keeps its data in ./data."
