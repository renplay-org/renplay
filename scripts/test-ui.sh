#!/bin/sh
# Acceptance always uses this exact official browser image, locally and in CI.
set -eu
cd "$(dirname "$0")/.."
image=mcr.microsoft.com/playwright:v1.64.1-noble@sha256:2f05f8a734509a7b3f26a912639488ee08f58a7b292d14d62271bcff9038768f
name=renplay-ui-$(printf '%s' "$PWD" | cksum | cut -d ' ' -f 1)
warm=false
case "${1:-}" in
  --warm) warm=true; shift ;;
  --stop) docker rm -f "$name" >/dev/null 2>&1 || true; exit 0 ;;
esac
if [ "$warm" = false ]; then
  name=$name-$$
  trap 'docker rm -f "$name" >/dev/null 2>&1 || true' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
fi
mkdir -p ui-test-results
# Playwright's --only-changed needs the real refs and index, including in a linked worktree.
# Git metadata is read-only. GIT_WORK_TREE makes the mirrored Linux sources its working tree.
common=$(git rev-parse --path-format=absolute --git-common-dir)
gitdir=$(git rev-parse --absolute-git-dir)
case "$gitdir" in
  "$common") gitdir=/repo-git ;;
  "$common"/*) gitdir=/repo-git/${gitdir#"$common"/} ;;
  *) echo 'The Git directory must be inside the common directory.'; exit 1 ;;
esac
if [ "$(docker inspect -f '{{.State.Running}} {{.Config.Image}}' "$name" 2>/dev/null || true)" != "true $image" ]; then
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker run -d --rm --name "$name" --init --ipc=host --cpus="${UI_CPUS:-4}" \
    -v "$PWD:/src:ro" -v "$PWD/ui-test-results:/out" \
    -v "$common:/repo-git:ro" -e GIT_DIR="$gitdir" -e GIT_WORK_TREE=/work \
    -v rp-server-nm:/work/server/node_modules \
    -v rp-selector-nm:/work/selector/node_modules \
    -v rp-ui-docs-nm:/work/docs/site/node_modules \
    -v rp-ui-tools:/tools \
    "$image" sleep infinity >/dev/null
fi
# Serialize runs within this workspace. Each invocation reads fresh source and environment inputs.
docker exec \
  -e CI="${CI:-}" -e UI_REPEAT="${UI_REPEAT:-0}" \
  -e LAYOUT_ONLY="${LAYOUT_ONLY:-}" -e LAYOUT_RUNS="${LAYOUT_RUNS:-1}" -e LAYOUT_DEBUG="${LAYOUT_DEBUG:-}" \
  "$name" timeout "${UI_TIMEOUT:-820}" flock /tmp/ui-run.lock bash /src/scripts/test-ui-container.sh "$@"
