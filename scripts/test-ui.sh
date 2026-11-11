#!/bin/sh
# Acceptance always uses this exact official browser image, locally and in CI.
set -eu
cd "$(dirname "$0")/.."
mkdir -p ui-test-results
image=mcr.microsoft.com/playwright:v1.64.1-noble@sha256:2f05f8a734509a7b3f26a912639488ee08f58a7b292d14d62271bcff9038768f
docker run --rm --init --ipc=host --cpus="${UI_CPUS:-4}" \
  -e CI="${CI:-}" -e UI_REPEAT="${UI_REPEAT:-0}" \
  -e LAYOUT_ONLY="${LAYOUT_ONLY:-}" -e LAYOUT_RUNS="${LAYOUT_RUNS:-1}" -e LAYOUT_DEBUG="${LAYOUT_DEBUG:-}" \
  -v "$PWD:/src:ro" -v "$PWD/ui-test-results:/out" \
  -v rp-server-nm:/work/server/node_modules \
  -v rp-selector-nm:/work/selector/node_modules \
  -v rp-ui-docs-nm:/work/docs/site/node_modules \
  -v rp-ui-tools:/tools \
  "$image" timeout 820 bash /src/scripts/test-ui-container.sh "$@"
