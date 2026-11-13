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
- **An idea or a feature:** open an
  [idea](https://github.com/renplay-org/renplay/issues/new?template=feature_request.yml) or
  [engine compatibility](https://github.com/renplay-org/renplay/issues/new?template=engine_compatibility.yml)
  issue first for a new engine, a change to how games run (runtimes, the game frame or Python
  compatibility), a new setting or anything large. Small fixes can go straight to a pull request.

Please follow the [code of conduct](https://github.com/renplay-org/renplay/blob/dev/CODE_OF_CONDUCT.md).
We aim to give a first answer to an issue or pull request within a week.

## Development setup

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

## The website

renplay.org is in `website/` of the repository: plain HTML and CSS, with no build step beyond
copying the files. `mise run website` shows it on `http://localhost:5190`, and `mise run
check:website` checks every link and picture in it. The docs and the website go live with each
release.

## Product rules

These decide most review comments:

- **Curated, not configurable.** Title, developer, tags, links and cover come only from the catalog.
- **Ren’Py first.** Other engines are Beta, and never make Ren’Py worse.
- **Saves are sacred.** Never delete or rewrite save data as a side effect.
- **Works on phones.** Every screen works at 390 px wide, with touch only.
- **Plain, short copy.** Sentence case, “Renplay” with a capital, no exclamation marks.
- **Safe for work.** Nothing published may show adult art.

## Pull requests

1. Fork the repository and create a branch from `dev`, the default branch. Keep one change per
   pull request and target `dev`, not `main` or a release branch.
2. Use Conventional Commit titles (`feat:`, `fix:`, `perf:`, `docs:`, `chore:`) for commits and the
   pull request. Explain what changes and why, and link the issue it closes.
3. Run `mise run check`: type checks, tests, the structure rules (no import cycles, layers that
   point down, no unused exports, files of at most 600 lines) and the writing rule. Add a test of
   new behavior that fails without the change.
4. For interface changes, check a 390 px phone in portrait and landscape, and a desktop. State which
   devices and browsers you tried by hand and what was only checked in a test browser. Follow the
   [browser test guide](https://github.com/renplay-org/renplay/blob/dev/CONTRIBUTING.md#browser-tests)
   for the required pinned Linux container run.
5. Add a line to `CHANGELOG.md` under `Unreleased` for anything users notice. Update the docs when
   setup, configuration or described behavior changes.
6. For the game frame, `runtime/` or `server/src/play/`, follow the
   [player security checklist](/developers/architecture/#player-security-checklist).

CI runs on pull requests, including those from forks. A first-time contributor's runs wait for a
maintainer's approval so untrusted code does not run before review. The required checks are `check`,
`Install contract` and `Browser suite`. Jobs may be skipped when their inputs have not changed, but
these required checks still report a result.

A maintainer reviews the pull request and may request changes. After review and passing required
checks, it is squash-merged into `dev`. You do not need to sign your commits: `dev` does not require
signed commits, and GitHub signs the squash commit. `main` and release branches require signed
commits, but contributors never target them.

### AI-assisted work

AI-assisted work is welcome. The person opening the pull request must have run and tested the work,
understand it and answer for it. State what was checked by hand and on which devices, separately
from what was only checked in a test browser. This evidence is needed whether or not AI helped.

### Licence

Contributions are under the project's [MIT licence](https://github.com/renplay-org/renplay/blob/dev/LICENSE).
There is no contributor agreement.

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
