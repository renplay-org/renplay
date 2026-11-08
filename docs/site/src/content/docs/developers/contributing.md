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

You need [mise](https://mise.jdx.dev) and, for the image, Docker. mise installs the pinned tools
(Node 24, Python, Helm and the linters) and runs the tasks in `mise.toml`, the same ones CI runs.

```sh
mise install          # the tools
mise run install      # the npm packages
mise run dev          # the server on port 3999 and the library on http://localhost:5199
mise run check        # everything CI checks
mise tasks            # every task: test, docs, image, contract, screenshots, release
```

`RENPLAY_BACKEND=https://renplay.example mise run dev:ui` runs the library against a deployed
Renplay. Without mise, each task is a plain npm or node command you can read in `mise.toml`.

Put a game’s PC zip into `/tmp/rp/games/_archives/` and install it from the library.

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

Pull requests run CI, and a pull request merges when it is green. An `edge` image of any branch can be
built by hand (the **Edge image** workflow). A release is a `release-X.Y.Z` branch (versions bumped,
`Unreleased` moved into a dated section of the changelog) squash-merged into `main`. CI checks the
versions and the changelog, and the release workflow builds the image as
`ghcr.io/renplay-org/renplay:X.Y.Z` and `:latest`, publishes and signs the chart, tags `vX.Y.Z`
with the GitHub release, deploys the docs and rebuilds the demo. The docs deploy with releases, so
they describe the released version. The full procedure is in the repository’s
`.agents/skills/release/SKILL.md`.

## The project

Renplay is made by the Renplay Team, under the [MIT license](https://github.com/renplay-org/renplay/blob/main/LICENSE).
Ren’Py is © Tom Rothamel and contributors, under its own license. Games belong to their developers.
[Support Renplay](https://renplay.org/support).
