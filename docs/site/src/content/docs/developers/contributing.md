---
title: Contributing
description: Set up a development environment and open a pull request.
---

Thanks for helping with Renplay. Pick what fits:

- **A game does not work, or you got one working:** that belongs in the
  [catalog](https://renplay.org/github/catalog) (requests, broken games, new recipes). See
  [Catalog and recipes](/catalog/).
- **A bug in Renplay itself:** open a
  [bug report](https://github.com/renplay-org/renplay/issues/new?template=bug_report.yml). For a
  failed install, attach the job log from **Settings** → **Activity**.
- **An idea:** open an [issue](https://renplay.org/issues) describing it before writing code, so we
  can agree on the approach.

## Development setup

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

Put a game’s PC zip into `/tmp/rp/games/_archives/` and install it from the UI. `make test` runs the
server tests and the UI type check; `make dev` runs the container with `./games` and `./data`.

Read [How Renplay works](/developers/architecture/) for how the pieces fit together. The repository’s
`AGENTS.md` lists the product rules and lessons learned, and is useful for humans too.

## The docs

These docs live in `docs/site` of the repository and are built with
[Starlight](https://starlight.astro.build/).

```sh
cd docs/site && npm ci && npm run dev    # http://localhost:4321
```

The **Configuration** page is generated from `server/src/envvars.ts`. Add or change an environment
variable there, run `npm run gen` in `docs/site`, and commit the page. A server test fails when the
page is stale.

Image examples use a `RENPLAY_VERSION` token wrapped in double underscores in their Markdown source. The
`remark-version.mjs` plugin replaces it with `server/package.json`’s version at build time, including
inside code blocks, so copyable commands always match the release.

## Product rules

These decide most review comments:

- **Curated, not configurable.** Title, developer, tags, links and cover come only from the catalog.
- **Ren’Py first.** Other engines are Beta, and never make Ren’Py worse.
- **Saves are sacred.** Never delete or rewrite save data as a side effect.
- **Works on phones.** Every screen works at 390 px wide, with touch only.
- **Plain, short copy.** Sentence case, “Renplay” with a capital, no exclamation marks.
- **Safe for work.** Nothing published may show adult art.

## Pull requests

1. Branch from `dev` and open the pull request against `dev`.
2. Keep it focused. The title follows Conventional Commits (`feat:`, `fix:`, `perf:`, `docs:`).
3. Run `npx tsc -p . && npx vitest run` in `server` and `npx tsc -b --noEmit && npm run build` in
   `selector`. Add a test for new server behavior.
4. For UI changes, look at them on a phone size and a desktop size
   (`cd server && npm run screenshots -- http://localhost:5199 /tmp/shots --sfw`).
5. Add a line to `CHANGELOG.md` under `Unreleased` for anything users notice.

Pull requests are squash-merged.

## Releases

`dev` is built into the `edge` image on every merge. A release is a `release-X.Y.Z` branch (versions
bumped, `Unreleased` moved into a dated section of the changelog) squash-merged into `main`. CI
checks the versions and the changelog, and the release workflow tags `vX.Y.Z`, publishes the GitHub
release and pushes the image as `ghcr.io/renplay-org/renplay:X.Y.Z` and `:latest`. The docs deploy
from `main`, so they describe the released version. The full procedure is in the repository’s
`.agents/skills/release/SKILL.md`.

## The project

Renplay is made by the Renplay Team, under the [MIT license](https://github.com/renplay-org/renplay/blob/main/LICENSE).
Ren’Py is © Tom Rothamel and contributors, under its own license. Games belong to their developers.
[Support Renplay](https://renplay.org/support).
