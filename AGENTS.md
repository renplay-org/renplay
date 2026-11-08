# Renplay: notes for agents

Renplay is a self-hosted web app that plays the PC releases of Ren'Py visual novels in the browser,
on desktops and phones, with saves stored on the server. A user adds a game's normal PC download;
Renplay builds it for the web (no Ren'Py SDK, the game's code never runs on the server), streams
its assets, and syncs every save to the server so play continues on any device. HTML games (Twine
and similar) play too, as second-class citizens. Other engines are added only when their normal download plays as easily
(`docs/site/src/content/docs/engines.md`).

Read this file before changing anything. `README.md` is for users, `CONTRIBUTING.md` for human
contributors, `docs/site/src/content/docs/developers/architecture.md` explains the internals in depth, `CHANGELOG.md` records every
user-visible change.

## Related repositories (organization renplay-org)

| Repository | What |
|---|---|
| `renplay` (this one) | The app (server, library UI, in-game runtime, container image), its chart, the docs, the website (renplay.org) and the demo |
| `catalog` | Curated recipes and art, published as `https://catalog.renplay.org/index.v4.json` (schema 4) |
| `engines` | Official Ren'Py web engines repackaged per version, index at `https://engines.renplay.org/index.json` |
| `website` | Archived: the website moved into this repository's `website/`, with its history |
| `.github` | Organization profile and the default `FUNDING.yml` (Ko-fi) |

## Product rules

These decide most review comments. Follow them without being asked.

- **Curated, not configurable.** Title, developer, tags and links come only from the game's
  catalog recipe, and users cannot edit them. Art is the one exception: the recipe gives the
  default, and a person can choose another picture or upload one for their own view, an admin for
  everyone. There are no per-install engine options in the UI. Add a setting only when a real user
  need cannot be solved by better defaults or a recipe.
- **Ren'Py first.** Renplay is a Ren'Py player. Other engines are second-class and shown as Beta:
  recognized, and supported only when their normal download plays easily (HTML games today), with
  the features that come cheap. A feature may work only for Ren'Py; never make Ren'Py worse for
  another engine. Unity and Godot web builds still install (the code stays) but are unsupported: never in the catalog,
  the docs, the website or the app's messaging. Status: `docs/site/src/content/docs/engines.md`.
- **Saves are sacred.** Never delete or rewrite save data as a side effect. Every overwrite and
  delete keeps history. Uninstall and reinstall leave saves alone.
- **Works on phones.** Every screen must work at 390 px wide in portrait and in landscape, with
  touch only (no hover). The player respects safe-area insets and has no hover-only controls.
- **Sentence case, no lowercase starts.** "Renplay" (never "renplay" in UI text or prose; the
  lowercase name is only for repository, package, image and URL names), "Installed", "Not
  installed", tags shown capitalized. No all-caps labels. Text after a "·" separator starts with
  a capital letter too.
- **Plain, short copy.** Full sentences, no jargon (say "save folder", not "config.save_directory",
  outside developer-facing places), no exclamation marks. No semicolons, em dashes, en dashes or
  ellipses in text people read: the interface, server messages and logs, docs, the changelog,
  commit and pull request text. Hyphens in compound words, and semicolons in code, are fine.
  `node scripts/check-copy.mjs` checks the interface, server messages and the changelog in CI.
- **Adult games have three levels.** Off (they do not exist for that person), Blurred (they show,
  but no picture of them is ever sent) and Shown, set by the installation, the person's account (an
  admin or a sign-in group), the person and the device. Each layer only narrows the one above. The
  server enforces the person's level and the device's on every route (`content.ts`). Every route is
  listed in `adult-levels.test.ts` with what the levels do on it, so a new route fails the tests
  until it is classified. At Blurred the game plays (with its walkthrough and the person's save
  files) but no picture of it is sent. Safe-for-work games
  are never affected.
- **Safe for work on GitHub.** Nothing published (docs, screenshots, the website, the catalog)
  may show adult art, even though many games are adult. Covers of adult games are linked from the
  developers' hosting, never copied; screenshots use `--sfw` (adult pictures blurred) or
  safe-for-work art.

## Layout

```
server/            Node 24 + TypeScript (Express 5, node:sqlite, sharp, yauzl). Tests: vitest.
  src/app.ts         HTTP app; src/index.ts starts it
  src/config.ts      Environment variables (all documented in README.md)
  src/db.ts          SQLite schema and migrations (PRAGMA user_version)
  src/catalog.ts     Catalog index: recipe matching, linking games to recipes, updates
  src/art.ts         The art cache: five formats per game, the making order, choices, uploads
  src/engines.ts     Engine packs: index, download on demand, checksum, pruning
  src/builds.ts      Build folders /games/<id>/<build>/, build.json, caches
  src/jobs.ts        Background job queue (installs, mod builds, hashing) with logs
  src/mods.ts        The mod overlay (user files layered over a build)
  src/pipeline/      Install pipeline: archive.ts (zip/7z/rar reading), rpa.ts (RPA split, data-only
                     pickle in util/pickle.ts), project.ts (extraction), optimize.ts (WebP),
                     progressive.ts (what streams), pack.ts (asset packs), assemble.ts (game.zip),
                     import.ts (the whole install), applymods.ts (mod builds), detect.ts
  src/routes/        REST API: games, library (imports, uploads, archives, catalog), saves, files
                     (mod file browser), play (game pages and streamed assets), system
  src/saves/         Save store with history; savefile.ts reads Ren'Py save metadata
  scripts/           screenshots.mjs (Playwright, phone and desktop)
selector/          The library UI: React 19, Vite, Tailwind 4, TanStack Query. No tests; type-checked.
  src/pages/         Library, Catalog, GamePage, AddGames, Player, Settings, Activity, Account, Users
  src/lantern/       The 4.0 design system: Tile, Stage, the room, Sheet, controls, focus, travel
                     (tokens and styles in src/index.css, the reference prototype in renplay-plans)
  src/components/    AppShell (header, tab bar, footer), SaveGallery, FileBrowser, ui.tsx
  src/lib/           api.ts (types and fetch), queries.ts, display.ts (screen geometry), format.ts
runtime/           renplay-runtime.js: plain ES5-style script injected into every game page
image/             The image's own files: nginx.conf.template and entrypoint.sh (in /app/deploy inside it)
charts/renplay/    The Helm chart
deploy/            For people running Renplay: compose.yaml, caddy/, nginx/, kubernetes/. The docs show
                     these files (a code block marked file=deploy/<path>), CI checks them (tests/examples.sh)
demo/              The public demo's image (demo.renplay.org, on Render)
docs/              Logo, screenshots, and site/: the docs (Starlight, docs.renplay.org). The Configuration
                     page is generated from server/src/envvars.ts (`npm run gen` in docs/site)
website/           renplay.org: plain HTML and CSS (home, catalog browser), _redirects for the stable
                     addresses (/docs, /github, /demo...), www/ the www.renplay.org redirect
tests/             The image's install contract, the chart's tests, the deploy/ examples
scripts/           Repo checks (writing rule, built library, website links), release.mjs, package-chart.py
mise.toml          Pinned tools and every task, locally and in CI
```

## How it fits together

```
browser ── nginx :8080 ─┬─ /                      library UI (selector/dist)
                        ├─ /g/<id>/<build>/        game page (rendered from the engine template)
                        ├─ /g/<id>/<build>/game/…  streamed assets, from assets.pack via the server
                        ├─ /engine/<version>/…     shared Ren'Py web engine (gzip)
                        └─ /api/…                  node server on 127.0.0.1:3000
```

- **Install** (`pipeline/import.ts`): read the archive in place, detect the layout and Ren'Py
  version, pick the engine (recipe, `RENPLAY_ENGINE`, or newest of the game's major version), split
  RPAs while streaming, convert images to WebP, write streamed files into one append-only
  `assets.pack` (+ `assets.json` index) and everything else into `game.zip` with the engine's
  `renpy.zip`, WebP placeholders and the streaming list. The build appears atomically as
  `/games/<id>/<build>/`; builds never change afterwards.
- **Mods** create `<build>.m<hash>/` holding only a new `game.zip` and caches; files fall back to
  the base build.
- **Playing:** the game page is the engine's `index.html` with the runtime injected. The runtime
  paces frames to the display, loads the engine compressed from Cache Storage, resumes interrupted
  `game.zip` downloads with Range requests, keeps `~/.renpy` in memory and syncs it with the server,
  restores compiled caches (bytecode and recompiled `.rpyc`), and talks to the player UI through
  `postMessage` (`renplay:*` messages).
- **Catalog:** fetched every 6 hours or on demand. Games link to recipes by id, archive or save
  folder (`Catalog.link`). The art cache (`art.ts`) downloads each picture once and makes every
  format into `/data/art` under content-hashed names.

## Lessons that shaped the code

- **Network storage hates small files.** Creating a file on the NFS games share costs 100–250 ms,
  so builds keep streamed assets in one pack (four files per build), and deletions run as a
  `nice rm -rf` child process (`util/purge.ts`), because `fs.rm` on NFS starved Node's thread pool
  and stalled the API.
- **Never shadow browser globals in the runtime.** A variable named `caches` broke Cache Storage;
  the runtime's own is `pyCaches`.
- **Proxies change bodies.** The deployment's gateway strips `Accept-Encoding` and a scale-to-zero
  proxy gunzips, so the engine is served as `.gz` files and decoded with `DecompressionStream`.
- **HTTP/3 drops long downloads** through the gateway (`ERR_QUIC_PROTOCOL_ERROR`); the runtime
  resumes `game.zip` with Range requests and shows an error with a retry button after 8 failures.
- **Ren'Py recompiles old games' scripts** on the newer web engine on every start (17 s for Pale
  Carnations); the runtime stores the recompiled `.rpyc` files with the build.
- **Vertex uploads stalled busy menus.** Emscripten emulates Ren'Py's client-side vertex arrays by
  overwriting pooled buffers (bufferSubData) before every draw; browsers' GPU processes then wait
  for earlier draws. The runtime gives each whole upload fresh storage (bufferData): 15 -> 60 fps on
  Ripples' menu (170 draws a frame). A menu that is slow while the main thread is idle points at
  the GPU process; count WebGL calls per frame before suspecting images or Python.
- **Download links do not work from the server.** File hosts (Mediafire, Mega, Google Drive…)
  tie a direct link to the browser and IP that opened it, and official stores need the user's
  login, so "install from a link" failed for real links and was removed. Games arrive by upload or
  through the archives folder.
- **Ren'Py 7 games run on the Ren'Py 8 engine.** Ren'Py 8 loads their compiled scripts and
  compiles all their Python at load time, so a game that starts has no Python 2 syntax; what can
  still fail is Python 2 behaviour (xrange, iteritems, unicode). Once in a Lifetime (7.3.2)
  played through its opening, a fight minigame and more without errors. Harem Hotel (7.4.11)
  does not: it sorts numbers with text, which Python 3 refuses.
- **Load the developer's .rpyc, not the .rpy.** A `.rpyc` stores its source's digest with a
  marker of the Ren'Py version that wrote it, so Ren'Py 8.5 sees every older game's `.rpyc` as
  stale and compiles the `.rpy` again, with a stricter parser and Python 3.12 (Harem Hotel's
  empty `screen`, Heros Harem Guild's `[:02]` and `xadjustment` failed that way). Builds keep
  sources out of `game.zip` when the `.rpyc` is there (`setSourcesAside`). Ren'Py's own Python 2
  fixer (`renpy.compat.fixes`) uses `tokenize`, which Python 3.12 makes fail on the very code it
  should fix; `webcompat.ts` retries from the error's position instead.
- **iPhone Safari cannot make a page fullscreen.** Only a home-screen web app fills the screen;
  the player explains that instead of showing a broken button.

## Commands

`mise.toml` pins the tools and holds every task. CI runs the same tasks.

```sh
mise install && mise run install    # tools and npm packages
mise run dev                        # server on :3999 (data in /tmp/rp) and library on http://localhost:5199
RENPLAY_BACKEND=https://renplay.example mise run dev:ui   # library against a deployed server
mise run check                      # everything CI checks, or one part: check:server, check:ui,
                                    # check:docs, check:chart, check:copy, check:workflows, check:examples
mise run test                       # server tests only
mise run image && mise run contract # the image as renplay:dev, its install contract, deploy/compose.yaml
mise run screenshots http://localhost:5199 /tmp/shots --sfw   # phone and desktop, read-only
mise run release 4.4.0              # a release branch's versions and changelog (release skill)
```

Inside `server/`: `npx tsc -p .` builds to `dist/`, `npx vitest run src/__tests__/x.test.ts` runs one
test file. Screenshots need `npx playwright install chromium webkit` once.

## Definition of done

1. Server type check and tests pass; new behavior has a test (`server/src/__tests__`).
2. The UI type-checks and builds.
3. UI changes are looked at on a phone size (WebKit, iPhone) and a desktop size, using
   `npm run screenshots` or Playwright directly. No page errors.
4. User-visible changes have a line in `CHANGELOG.md` under `Unreleased`, written for users.
5. README or the docs (`docs/site`) updated when setup, configuration or behavior described there changed. A new
   environment variable goes in `server/src/envvars.ts`, then `npm run gen` in `docs/site`.

## Workflow

- **Branches:** `dev` is the integration branch; `main` only receives releases. Work on a short
  branch from `dev` (`feat-…`, `fix-…`), open a pull request against `dev`, squash-merge.
- **Commits and PR titles:** Conventional Commits (`feat:`, `fix:`, `perf:`, `docs:`, `chore:`).
  The body says why, and what was tested.
- **CI** (`.github/workflows/ci.yml`) runs on pull requests into `dev` and `main`, and the
  rulesets require it: `check` (type checks, tests, the interface, docs, chart, workflow and
  deploy/ examples lint), `Install contract` (on amd64 and arm64: the image from a build cache, users
  and a read-only root, an install, the upgrade from the newest release and back, the chart on
  kind, deploy/compose.yaml; skipped when nothing in the image or the chart changed), and
  `release-check` on release PRs. Nothing runs on pushes: `dev` only gets what a PR tested.
  Upgrades are tested from the newest release only: nobody runs 2.x or 3.x.
- **Workflows:** `release.yml` (push to `main`), `image.yml` (the multi-arch image, called by the
  release and by `edge.yml`), `edge.yml` (by hand: an `edge` image to try a branch on a server),
  `sites.yml` (the docs and the website, with each release or by hand), `demo.yml` (the demo, with each release or
  by hand). Actions are pinned by commit SHA, Dependabot keeps them and the npm and Docker
  dependencies current (weekly, grouped, into `dev`). `actionlint` and `zizmor` check the workflows.
- **Releases:** see the `release` skill. A `release-X.Y.Z` branch from `dev` bumps
  `server/package.json` and `selector/package.json`, moves `Unreleased` into a dated
  `## [X.Y.Z] - YYYY-MM-DD` section, and is squash-merged into `main`. CI checks versions and the
  changelog. `release.yml` then builds the image (`X.Y.Z` and `latest`, GHCR and Docker Hub),
  publishes and signs the chart, tags `vX.Y.Z` with the changelog section as the GitHub release,
  deploys the docs and rebuilds the demo. Afterwards `dev` fast-forwards to the release branch. (`main` only gets squashed releases, so it never shares history with `dev`; the
  release branch records it with `git merge -s ours`.)
- **Cadence:** release when a coherent set of changes is done and verified on a running instance,
  at least every few weeks while there are changes; patch releases for fixes any time.
- **Versioning:** SemVer. Minor for features, patch for fixes, major when upgrading needs action
  from the operator (the changelog says what).

## Deployment

The reference deployment runs on Kubernetes (Flux) and pins a released image by tag and digest
(`ghcr.io/renplay-org/renplay:X.Y.Z@sha256:…`); Renovate proposes new releases. To try a build
there first, run **Edge image** (`edge.yml`) on the branch, pin the `edge@sha256:…` digest it prints
temporarily, then pin the release. Data lives in
`/data` (a persistent volume, backed up); `/games` can be rebuilt from `/games/_archives`.

Agents never push to `main`, merge releases, or change a deployment on their own; they prepare
branches and pull requests and say what is left to do.

## Skills

Procedures for agents live in `.agents/skills/` (linked as `.claude/skills/`):

- `release`: cut a release (versions, changelog, PR, tag, image, deployment).
- `ui-check`: look at UI changes on a phone and a desktop before calling them done.
