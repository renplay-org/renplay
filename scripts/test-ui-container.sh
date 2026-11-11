#!/bin/bash
set -euo pipefail
# The official image ships Node 26. Install the pinned Node 24 binary, not another image.
case "$(uname -m)" in
  aarch64) arch=arm64; sha=d28c8a5bf0a808f0ed434a1dce8c54ae98f0371c0bd86ac58abc613f73e6643f ;;
  x86_64) arch=x64; sha=f625d97cd707df4ff96254916fbc5ff014f09c09effe5a1e0ca8f6d41a8789d4 ;;
  *) echo 'Unsupported CPU'; exit 1 ;;
esac
if [ ! -x /tools/node/bin/node ]; then
  curl -fsSL "https://nodejs.org/dist/v24.19.0/node-v24.19.0-linux-$arch.tar.gz" -o /tmp/node.tar.gz
  echo "$sha  /tmp/node.tar.gz" | sha256sum -c -
  mkdir -p /tools/node
  tar -xzf /tmp/node.tar.gz --strip-components=1 -C /tools/node
  rm /tmp/node.tar.gz
fi
export PATH="/tools/node/bin:$PATH"
[ "$(node --version)" = v24.19.0 ]
mkdir -p /work
cd /src
tar --exclude=node_modules --exclude=dist --exclude=.git --exclude=ui-test-results -cf - . | (cd /work && tar xf -)
ln -s /out /work/ui-test-results
cd /work
for dir in server selector docs/site; do
  key=$(sha256sum "$dir/package-lock.json" | cut -d ' ' -f 1)
  if [ "$(head -1 "$dir/node_modules/.ui-lock" 2>/dev/null || true)" != "$key" ]; then
    (cd "$dir" && npm ci --no-audit --no-fund)
    echo "$key" > "$dir/node_modules/.ui-lock"
  fi
done
mode=${1:-all}
if [ "$#" -gt 0 ]; then shift; fi
case "$mode" in all|playwright|legacy|layout) ;; *) echo "Unknown browser suite: $mode"; exit 1 ;; esac
for arg in "$@"; do
  if [ "$arg" = --base ]; then echo 'Acceptance never connects to another library.'; exit 1; fi
done
if [ "$mode" != layout ]; then (cd selector && npm run build); fi
if [ "$mode" = layout ] || [ "$mode" = all ]; then
  sh website/build.sh
  (cd docs/site && npm run build)
fi
status=0
start=$SECONDS
if [ "$mode" = all ] || [ "$mode" = legacy ]; then
  repeats=1
  if [ "$mode" = legacy ] && [ "${UI_REPEAT:-0}" -gt 0 ]; then repeats=$UI_REPEAT; fi
  for ((i=1; i<=repeats; i++)); do
    echo "Legacy run $i of $repeats"
    (cd server && node scripts/check-app-ui.mjs "$@") 2>&1 | tee /out/legacy.txt || { status=1; break; }
  done
  echo "Legacy wall time: $((SECONDS-start)) s" | tee /out/legacy-time.txt
  grep -E '^FAIL|^(All passed|[0-9]+ failed):' /out/legacy.txt > /out/legacy-summary.md || true
fi
if [ "$mode" = all ] || [ "$mode" = layout ]; then
  at=$SECONDS
  node scripts/check-layout-shift.mjs 2>&1 | tee /out/layout.txt || status=1
  echo "Layout wall time: $((SECONDS-at)) s" | tee /out/layout-time.txt
  passed=$(grep -c '^ok ' /out/layout.txt || true)
  failed=$(grep -c '^FAIL ' /out/layout.txt || true)
  printf 'Layout: %s passed, %s failed.\n' "$passed" "$failed" > /out/layout-summary.md
  grep '^FAIL ' /out/layout.txt >> /out/layout-summary.md || true
fi
if [ "$mode" = all ] || [ "$mode" = playwright ]; then
  args=()
  if [ "${CI:-}" ]; then args+=(--fail-on-flaky-tests); fi
  if [ "${UI_REPEAT:-0}" -gt 0 ]; then args+=(--repeat-each="$UI_REPEAT" --retries=0); fi
  (cd server && npx playwright test --config scripts/app-ui/playwright.config.mjs "${args[@]}" "$@") || status=1
  tag=playwright
  for arg in "$@"; do case "$arg" in --project=*) tag=${arg#--project=} ;; esac; done
  cp /out/report.json "/out/$tag-report.json"
  cp /out/summary.md "/out/$tag-summary.md"
fi
if [ "$mode" = all ]; then
  echo "Whole browser suite wall time: $((SECONDS-start)) s (budget 300 s)." | tee /out/total-time.txt
  if [ "$((SECONDS-start))" -ge 300 ]; then echo 'Browser suite exceeded the five minute budget.'; status=1; fi
fi
exit "$status"
