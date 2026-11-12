# Contributing

Thanks for helping with Renplay. The long version is in the
[docs](https://docs.renplay.org/developers/contributing/); this is the short one.

- **A game does not work, or you got one working:** that belongs in the
  [catalog](https://renplay.org/github/catalog) (requests, broken games, new recipes).
- **A bug in Renplay itself:** open a [bug report](https://github.com/renplay-org/renplay/issues/new?template=bug_report.yml).
  For a failed install, attach the job log from Settings › Activity.
- **An idea:** open an [issue](https://github.com/renplay-org/renplay/issues/new) describing it
  before writing code, so we can agree on the approach.

## Development

You need [mise](https://mise.jdx.dev) and, for the image, Docker. mise installs the pinned tools
(Node 24, Python, Helm and the linters) and runs the tasks in `tasks.toml`, the same ones CI runs.

```sh
mise install          # the tools
mise run install      # the npm packages, and a pre-push hook with the quick checks
mise run dev          # the server on port 3999 and the library on http://localhost:5199
mise run check        # everything CI checks
mise tasks            # every task: test, docs, image, contract, screenshots, release
```

`RENPLAY_BACKEND=https://renplay.example mise run dev:ui` runs the library against a deployed
Renplay. Without mise, each task is a plain npm or node command you can read in `tasks.toml`.

Put a game's PC zip into `/tmp/rp/games/_archives/` and install it from the library.

[How Renplay works](https://docs.renplay.org/developers/architecture/) explains how the pieces fit together, and
[AGENTS.md](AGENTS.md) lists the product rules and lessons learned (useful for humans too).

## Browser tests

Run `mise run test:ui` with Docker. It runs the old library checks, website/docs layout checks and
Playwright Test suite in the same official Linux container as CI, pinned by digest with Node 24
and matching Playwright packages. Only this container run counts for acceptance. Native Mac browsers
are useful for quick tries, not acceptance. The suite uses mock games and blocks external requests.
Never point it at a real library.

The Playwright suite runs one worker: Chromium at 1440 px and touch WebKit at 390 px in portrait, then 844 by
390 px in landscape. It retains failure traces and writes JSON and a text summary into
`ui-test-results/`. A pass only on retry warns locally and fails CI. The normal complete browser
suite must finish in under five minutes. There are no screenshots in pull requests.

While working, run only the tests a change touches. `--warm` starts a container for this worktree
once, then uses `docker exec` on later runs. It syncs source changes and deletions, installs only
when a lockfile changed, and rebuilds the library only when its inputs changed, including shared
server types. Without `--warm`, the container is removed after the run.

```sh
# App changes: choose the affected behavior and, if useful, one browser project.
sh scripts/test-ui.sh --warm playwright --project=chromium-desktop --grep 'Library: address'
# Test or imported helper changes: let Playwright select affected test files.
sh scripts/test-ui.sh --warm playwright --only-changed=origin/dev
# Re-run the failures from the last Playwright run.
sh scripts/test-ui.sh --warm playwright --last-failed
# One subject from the older checks (names are in server/scripts/app-ui/).
sh scripts/test-ui.sh --warm legacy --only search
mise run test:ui:stop
```

Playwright's `--only-changed` follows test imports, not the app's built assets. For changes to the
app, select the relevant tests explicitly. Keep `origin/dev` current with `git fetch origin dev`.
`--last-failed` uses the last result in `ui-test-results/traces/.last-run.json`, also across cold runs.

Run the whole suite once at the end, in the container, and push only after it passes. Never re-run
a passing suite to make sure. A doubt about a test is a flake to report. Use the **Flake hunt**
workflow for repeats instead of repeating the whole suite in the working loop. Run it by hand on
your branch with a repeat count (default 10). It also runs nightly against `dev`. Both the older
checks and Playwright run without retries, and each job's summary lists every test that failed
at least once. Reports and failure traces are kept as artifacts.

`mise run check:app-ui` and `mise run check:layout` run their respective old checks in the container.
For a slow-phone layout investigation, use
`UI_CPUS=0.5 LAYOUT_ONLY=adult LAYOUT_RUNS=15 LAYOUT_DEBUG=1 sh scripts/test-ui.sh --warm layout`.
The container never writes source files in the checkout. Only results go to `ui-test-results/`.
It caches Linux dependencies in Docker volumes `rp-server-nm`, `rp-selector-nm`, `rp-ui-docs-nm`
and `rp-ui-tools`. Stop warm containers before deleting those volumes to reclaim space. The Mac's
`node_modules` are not used or modified. To change `UI_CPUS`, stop the warm container first.

CI runs the older checks, layout checks and Playwright in parallel, only when their inputs changed.
Workflow or shared runner changes select all three. The **Browser suite** summary reports on every
pull request, including when no browser inputs changed. Superseded runs of a pull request are cancelled.

Do not loosen a test without stopping to report it and getting a maintainer's approval. This includes removing
an assertion, widening a tolerance, adding or lengthening a fixed wait, skipping, quarantining,
or changing a test only to make it pass. A migration must keep equivalent or stronger assertions.

## Pull requests

1. Branch from `dev` and open the pull request against `dev`.
2. Keep it focused; the title follows Conventional Commits (`feat:`, `fix:`, `perf:`, `docs:`).
3. `mise run check` passes: type checks, tests, the structure rules in AGENTS.md and the writing
   rule. Add a test for new server behavior.
4. For UI changes, look at them on a phone size and a desktop size
   (`cd server && npm run screenshots -- http://localhost:5199 /tmp/shots`).
5. Add a line to `CHANGELOG.md` under `Unreleased` for anything users notice.
6. Docs live in `docs/site` (`npm ci && npm run build` there). A new or changed environment
   variable goes in `server/src/envvars.ts`; run `npm run gen` in `docs/site` to update the
   Configuration page, or the server tests fail.

Pull requests are squash-merged.

## Releases and deployment

Pull requests run CI, and a pull request merges when it is green. An `edge` image of any branch can be
built by hand (the **Edge image** workflow). Releases are cut from `dev` when a set of
changes is done and tested on a running instance, at least every few weeks while there is
something to release; fixes can ship as patch releases any time. Versions follow SemVer: minor for
features, patch for fixes, major when upgrading needs action from you (the changelog says what).

A release is a `release-X.Y.Z` branch (versions bumped, `Unreleased` moved into a dated section of
`CHANGELOG.md`) squash-merged into `main`. CI checks the versions and the changelog; the release
workflow tags `vX.Y.Z`, publishes the GitHub release with that changelog section, and pushes the
image as `ghcr.io/renplay-org/renplay:X.Y.Z` and `:latest`. The full procedure is in
[.agents/skills/release/SKILL.md](.agents/skills/release/SKILL.md).
