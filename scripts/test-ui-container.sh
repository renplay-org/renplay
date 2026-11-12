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
node /src/scripts/ui-workspace.mjs /src /work
ln -sfn /out /work/ui-test-results
cd /work
git config --global --add safe.directory /work
mode=${1:-all}
if [ "$#" -gt 0 ]; then shift; fi
case "$mode" in all|playwright|legacy|layout) ;; *) echo "Unknown browser suite: $mode"; exit 1 ;; esac
for arg in "$@"; do
  if [ "$arg" = --base ]; then echo 'Acceptance never connects to another library.'; exit 1; fi
done
dirs=(server)
if [ "$mode" != layout ]; then dirs+=(selector); fi
if [ "$mode" = layout ] || [ "$mode" = all ]; then dirs+=(docs/site); fi
for dir in "${dirs[@]}"; do
  key=$(sha256sum "$dir/package-lock.json" | cut -d ' ' -f 1)
  if [ "$(head -1 "$dir/node_modules/.ui-lock" 2>/dev/null || true)" != "$key" ]; then
    (cd "$dir" && npm ci --no-audit --no-fund)
    echo "$key" > "$dir/node_modules/.ui-lock"
  fi
done
if [ "$mode" != layout ]; then
  key=$(node -p "require('./.ui-workspace.json').library")
  if [ ! -d selector/dist ] || [ "$(cat /tmp/ui-library-key 2>/dev/null || true)" != "$key" ]; then
    (cd selector && npm run build)
    echo "$key" > /tmp/ui-library-key
  else
    echo 'Library inputs unchanged, using the previous build.'
  fi
fi
if [ "$mode" = layout ] || [ "$mode" = all ]; then
  sh website/build.sh
  (cd docs/site && npm run build)
fi
status=0
start=$SECONDS
if [ "$mode" = all ] || [ "$mode" = legacy ]; then
  repeats=1
  if [ "$mode" = legacy ] && [ "${UI_REPEAT:-0}" -gt 0 ]; then repeats=$UI_REPEAT; fi
  rm -f /out/legacy-run-*.txt
  printf '## Older browser checks\n' > /out/legacy-summary.md
  for ((i=1; i<=repeats; i++)); do
    echo "Legacy run $i of $repeats"
    printf '\n### Run %s of %s\n' "$i" "$repeats" >> /out/legacy-summary.md
    if ! (cd server && node scripts/check-app-ui.mjs "$@") 2>&1 | tee "/out/legacy-run-$i.txt"; then
      status=1
      printf 'Run failed. See legacy-run-%s.txt for the full log.\n' "$i" >> /out/legacy-summary.md
    fi
    grep -E '^FAIL|^(All passed|[0-9]+ failed):' "/out/legacy-run-$i.txt" >> /out/legacy-summary.md || true
  done
  echo "Legacy wall time: $((SECONDS-start)) s" | tee /out/legacy-time.txt
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
  tag=playwright
  for arg in "$@"; do case "$arg" in --project=*) tag=${arg#--project=} ;; esac; done
  rm -f /out/report.json /out/summary.md "/out/$tag-report.json" "/out/$tag-summary.md"
  (cd server && npx playwright test --config scripts/app-ui/playwright.config.mjs "${args[@]}" "$@") || status=1
  if [ -f /out/report.json ]; then cp /out/report.json "/out/$tag-report.json"; fi
  if [ -f /out/summary.md ]; then cp /out/summary.md "/out/$tag-summary.md"; fi
fi
if [ "$mode" = all ]; then
  echo "Whole browser suite wall time: $((SECONDS-start)) s (budget 300 s)." | tee /out/total-time.txt
  if [ "$((SECONDS-start))" -ge 300 ]; then echo 'Browser suite exceeded the five minute budget.'; status=1; fi
fi
exit "$status"
