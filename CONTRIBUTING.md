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

You need Node 24 and, for the container, Docker.

```sh
# Server: type check, tests, build
cd server && npm ci && npx tsc -p . && npx vitest run

# Run it
DATA_DIR=/tmp/rp/data GAMES_DIR=/tmp/rp/games PORT=3999 \
  RENPLAY_RUNTIME_PATH=$PWD/../runtime/renplay-runtime.js node dist/index.js

# UI with hot reload, proxying the API to :3999 (http://localhost:5199)
cd selector && npm ci && npm run dev
# …or against a deployed Renplay
RENPLAY_BACKEND=https://renplay.example npm run dev
```

Put a game's PC zip into `/tmp/rp/games/_archives/` and install it from the UI. `make test` runs
the server tests and the UI type check; `make dev` runs the container with `./games` and `./data`.

[How Renplay works](https://docs.renplay.org/developers/architecture/) explains how the pieces fit together, and
[AGENTS.md](AGENTS.md) lists the product rules and lessons learned (useful for humans too).

## Pull requests

1. Branch from `dev` and open the pull request against `dev`.
2. Keep it focused; the title follows Conventional Commits (`feat:`, `fix:`, `perf:`, `docs:`).
3. `npx tsc -p . && npx vitest run` in `server`, `npx tsc -b --noEmit && npm run build` in
   `selector`. Add a test for new server behavior.
4. For UI changes, look at them on a phone size and a desktop size
   (`cd server && npm run screenshots -- http://localhost:5199 /tmp/shots`).
5. Add a line to `CHANGELOG.md` under `Unreleased` for anything users notice.
6. Docs live in `docs/site` (`npm ci && npm run build` there). A new or changed environment
   variable goes in `server/src/envvars.ts`; run `npm run gen` in `docs/site` to update the
   Configuration page, or the server tests fail.

Pull requests are squash-merged.

## Releases and deployment

`dev` is built into the `edge` image on every merge. Releases are cut from `dev` when a set of
changes is done and tested on a running instance, at least every few weeks while there is
something to release; fixes can ship as patch releases any time. Versions follow SemVer: minor for
features, patch for fixes, major when upgrading needs action from you (the changelog says what).

A release is a `release-X.Y.Z` branch (versions bumped, `Unreleased` moved into a dated section of
`CHANGELOG.md`) squash-merged into `main`. CI checks the versions and the changelog; the release
workflow tags `vX.Y.Z`, publishes the GitHub release with that changelog section, and pushes the
image as `ghcr.io/renplay-org/renplay:X.Y.Z` and `:latest`. The full procedure is in
[.agents/skills/release/SKILL.md](.agents/skills/release/SKILL.md).
