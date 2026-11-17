# Contributing

Thanks for helping with Renplay. This is the short version. The long one is in the
[docs](https://docs.renplay.org/developers/contributing/).

- **A game does not work, or you got one working:** that belongs in the
  [catalog](https://renplay.org/github/catalog) (requests, broken games, new recipes).
- **A bug in Renplay itself:** open a [bug report](https://github.com/renplay-org/renplay/issues/new?template=bug_report.yml).
  For a failed install, attach the job log from Settings › Activity.
- **An idea or a feature:** open an [idea](https://github.com/renplay-org/renplay/issues/new?template=feature_request.yml)
  or [engine compatibility](https://github.com/renplay-org/renplay/issues/new?template=engine_compatibility.yml) issue
  first for a new engine, a change to how games run (runtimes, the game frame or Python compatibility),
  a new setting or anything large. Small fixes can go straight to a pull request.

Please follow the [code of conduct](CODE_OF_CONDUCT.md). We aim to give a first answer to an issue or
pull request within a week.

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

## The look and the words

- **One look, called Lamplight.** Colours, faces, corners and durations come only from
  `design/tokens.css`, fonts from `design/fonts.css` and the mark from `design/logo/`. The website is the
  reference: where the app differs from it, the app changes. [design/README.md](design/README.md) has the
  rules, and `mise run check:design` fails on a colour, face or corner written anywhere else.
- **Works on phones.** Every screen must work at 390 px wide, in portrait and in landscape, with touch
  only and no hover-only controls.
- **Plain, short copy.** Sentence case, full sentences, no exclamation marks. No semicolons, em dashes,
  en dashes or ellipses in text people read: the interface, server messages, docs, the changelog, and
  commit and pull request text. `mise run check:copy` checks the interface, the docs and the changelog.
- **Safe for work.** Nothing published may show adult art, in the docs, screenshots or the catalog. Take
  screenshots with `mise run screenshots <url> <dir> --sfw`, or use safe-for-work art.

## Browser tests

Run `mise run test:ui` with Docker. It runs the website/docs layout checks and the Playwright Test
suite in the same official Linux container as CI, pinned by digest with Node 24
and matching Playwright packages. Only this container run counts for acceptance. Native Mac browsers
are useful for quick tries, not acceptance. The suite uses mock games and blocks external requests.
Never point it at a real library.

The Playwright suite runs up to five workers (three in each WebKit project, and four and two on CI, whose four vCPUs are slower) over five projects: Chromium at 1440 px, touch WebKit at 390 px in
portrait and at 844 by 390 px in landscape, desktop WebKit for the static demo, and Chromium at 390 px with touch
for the library's own checks in `server/scripts/app-ui/specs/chromium/`. A spec says in its first line which
projects run it and why, so a test runs where it shows something new. It retains failure traces and writes JSON
and a text summary into `ui-test-results/`. A test that passes only on its retry does not fail a pull request: the job summary lists it as flaky, to fix from the flake hunt, and CI warns once for each. The normal complete browser
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
# One subject, in one project.
sh scripts/test-ui.sh --warm playwright --project=chromium-phone search-cues
mise run test:ui:stop
```

Playwright's `--only-changed` follows test imports, not the app's built assets. For changes to the
app, select the relevant tests explicitly. Keep `origin/dev` current with `git fetch origin dev`.
`--last-failed` uses the last result in `ui-test-results/traces/.last-run.json`, also across cold runs.

Run the whole suite once at the end, in the container, and push only after it passes. Never re-run
a passing suite to make sure. A doubt about a test is a flake to report. Use the **Flake hunt**
workflow for repeats instead of repeating the whole suite in the working loop. Run it by hand on
your branch with a repeat count (default 10). It also runs nightly against `dev`. Playwright runs
without retries, and the job's summary lists every test that failed at least once. Reports and
failure traces are kept as artifacts.

`mise run check:app-ui` and `mise run check:layout` run the Playwright specs and the layout check in the container.
For a slow-phone layout investigation, use
`UI_CPUS=0.5 LAYOUT_ONLY=adult LAYOUT_RUNS=15 LAYOUT_DEBUG=1 sh scripts/test-ui.sh --warm layout`.
The container never writes source files in the checkout. Only results go to `ui-test-results/`.
It caches Linux dependencies in Docker volumes `rp-server-nm`, `rp-selector-nm`, `rp-ui-docs-nm`
and `rp-ui-tools`. Stop warm containers before deleting those volumes to reclaim space. The Mac's
`node_modules` are not used or modified. To change `UI_CPUS`, stop the warm container first.

CI runs the layout checks and Playwright in parallel, only when their inputs changed. The rules are in
`scripts/ci-select.mjs`, and the job summary of the `changes` job says why each part ran or not. Texts and the docs
run no Playwright, and anything unknown, shared or deleted runs everything. The label `ci:full` (then re-run the
workflow) forces a full run. The **Browser suite** summary reports on every pull request, including when no browser
inputs changed. Superseded runs of a pull request are cancelled.

Do not loosen a test without stopping to report it and getting a maintainer's approval. This includes removing
an assertion, widening a tolerance, adding or lengthening a fixed wait, skipping, quarantining,
or changing a test only to make it pass. A migration must keep equivalent or stronger assertions.

## Pull requests

1. Fork the repository and create a branch from `dev`, the default branch. Keep one change per
   pull request and target `dev`, not `main` or a release branch.
2. Use Conventional Commit titles (`feat:`, `fix:`, `perf:`, `docs:`, `chore:`) for commits and the
   pull request. Explain what changes and why.
3. Run `mise run check` and add a test for new behavior that fails without the change. For interface
   changes, check a 390 px phone and a desktop, and the look against the website. Say which devices and
   browsers you tried by hand, and what was only checked in a test browser.
4. Add a line to `CHANGELOG.md` under `Unreleased` for anything users notice. Update the docs when
   setup, configuration or described behavior changes. Docs live in `docs/site`. For a new or changed
   environment variable, edit `server/src/envvars.ts` and run `npm run gen` in `docs/site`.
5. For the game frame, `runtime/` or `server/src/play/`, follow the
   [player security checklist](https://docs.renplay.org/developers/architecture/#player-security-checklist).

CI runs on pull requests, including those from forks. A first-time contributor's runs wait for a
maintainer's approval so untrusted code does not run before review. The required checks are `check`,
`Install contract` and `Browser suite`. Some jobs are skipped when their inputs have not changed.

A maintainer reviews the pull request and may request changes. After review and passing required
checks, it is squash-merged into `dev`. You do not need to sign your commits: `dev` does not require
signed commits, and GitHub signs the squash commit. `main` and release branches require signed
commits, but contributors never target them.

AI-assisted work is welcome. The person opening the pull request must have run and tested the work,
understand it and answer for it. Include the same hand-tested device and test-browser evidence
whether or not AI helped.

## Licence

Contributions are under the project's [MIT licence](LICENSE). There is no contributor agreement.

## Releases and deployment

Pull requests run CI, and a pull request merges when it is green. An `edge` image of any branch can be
built by hand (the **Edge image** workflow). Versions follow SemVer: minor for features, patch for
fixes, major when upgrading needs action from you (the changelog says what).

A release is a `release-X.Y.Z` branch (versions bumped, `Unreleased` moved into a dated section of
`CHANGELOG.md`) squash-merged into `main`. CI checks the versions and the changelog. The release
workflow pushes the image as `X.Y.Z` and `latest` to `ghcr.io/renplay-org/renplay` and Docker Hub
(`renplay/renplay`), publishes and signs the Helm chart, tags `vX.Y.Z`, publishes the GitHub release
with that changelog section, and rebuilds the docs and the demo. The full procedure is in
[.agents/skills/release/SKILL.md](.agents/skills/release/SKILL.md).
