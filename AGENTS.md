# Renplay: notes for agents

Renplay is a self-hosted web app that plays the PC releases of Ren'Py visual novels in the browser,
on desktops and phones, with saves stored on the server. A user adds a game's normal PC download;
Renplay builds it for the web (no Ren'Py SDK, the game's code never runs on the server), streams
its assets, and syncs every save to the server so play continues on any device.

Read this file before changing anything. `README.md` is for users, `CONTRIBUTING.md` for human
contributors, `docs/architecture.md` explains the internals in depth, `CHANGELOG.md` records every
user-visible change.

## Related repositories (organization renplay-web)

| Repository | What |
|---|---|
| `renplay` (this one) | The app: server, library UI, in-game runtime, container image |
| `catalog` | Curated recipes and covers, published as `https://renplay-web.github.io/catalog/index.json` |
| `engines` | Official Ren'Py web engines repackaged per version, index at `https://renplay-web.github.io/engines/index.json` |
| `renplay-web.github.io` | The website |
| `.github` | Organization profile and the default `FUNDING.yml` (Ko-fi) |

## Product rules

These decide most review comments. Follow them without being asked.

- **Curated, not configurable.** Title, developer, tags, links and cover come only from the game's
  catalog recipe. Users cannot edit them; there are no per-install image or engine options in the
  UI. Add a setting only when a real user need cannot be solved by better defaults or a recipe.
- **Saves are sacred.** Never delete or rewrite save data as a side effect. Every overwrite and
  delete keeps history. Uninstall and reinstall leave saves alone.
- **Works on phones.** Every screen must work at 390 px wide in portrait and in landscape, with
  touch only (no hover). The player respects safe-area insets and has no hover-only controls.
- **Sentence case, no lowercase starts.** "Renplay" (never "renplay" in UI text or prose; the
  lowercase name is only for repository, package, image and URL names), "Installed", "Not
  installed", tags shown capitalized. No all-caps labels. Text after a "·" separator starts with
  a capital letter too.
- **Plain, short copy.** Full sentences, no jargon (say "save folder", not "config.save_directory",
  outside developer-facing places), no exclamation marks.
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
  src/catalog.ts     Catalog index: recipe matching, linking games to recipes, cover cache, updates
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
  src/pages/         Library, GamePage, AddGames, Player, Settings, Activity
  src/components/    AppShell (navigation, footer), GameCard (covers), SaveGallery, FileBrowser, ui.tsx
  src/lib/           api.ts (types and fetch), queries.ts, display.ts (screen geometry), format.ts
runtime/           renplay-runtime.js: plain ES5-style script injected into every game page
deploy/            nginx.conf.template and entrypoint.sh for the container
docs/              Architecture notes, logo, screenshots
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
  folder (`Catalog.link`); covers are downloaded into `/data/covers` under content-hashed names.

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
- **iPhone Safari cannot make a page fullscreen.** Only a home-screen web app fills the screen;
  the player explains that instead of showing a broken button.

## Commands

```sh
# Server
cd server && npm ci
npx tsc -p .            # type check and build to dist/
npx vitest run          # tests (fixtures in src/__tests__)

# UI
cd selector && npm ci
npx tsc -b --noEmit     # type check
npm run build           # production build to selector/dist

# Run locally (two terminals)
cd server && DATA_DIR=/tmp/rp/data GAMES_DIR=/tmp/rp/games PORT=3999 \
  RENPLAY_RUNTIME_PATH=$PWD/../runtime/renplay-runtime.js node dist/index.js
cd selector && npm run dev                                   # http://localhost:5199
cd selector && RENPLAY_BACKEND=https://renplay.example npm run dev   # UI against a deployed server

# Container
docker build -t renplay:dev . && docker run -p 8080:8080 -v $PWD/games:/games -v $PWD/data:/data renplay:dev

# Screenshots (phone and desktop) of a running instance, read-only; --sfw for anything published
cd server && npx playwright install chromium webkit && npm run screenshots -- http://localhost:5199 /tmp/shots --sfw
```

`node --check runtime/renplay-runtime.js` checks the runtime's syntax. CI runs all of the above
except screenshots.

## Definition of done

1. Server type check and tests pass; new behavior has a test (`server/src/__tests__`).
2. The UI type-checks and builds.
3. UI changes are looked at on a phone size (WebKit, iPhone) and a desktop size, using
   `npm run screenshots` or Playwright directly. No page errors.
4. User-visible changes have a line in `CHANGELOG.md` under `Unreleased`, written for users.
5. README or `docs/` updated when setup, configuration or behavior described there changed.

## Workflow

- **Branches:** `dev` is the integration branch; `main` only receives releases. Work on a short
  branch from `dev` (`feat-…`, `fix-…`), open a pull request against `dev`, squash-merge.
- **Commits and PR titles:** Conventional Commits (`feat:`, `fix:`, `perf:`, `docs:`, `chore:`).
  The body says why, and what was tested.
- **CI** (`.github/workflows/ci.yml`): type checks, tests, UI build, and a container image per
  `dev` push, tagged `edge` and the commit sha.
- **Releases:** see the `release` skill. A `release-X.Y.Z` branch from `dev` bumps
  `server/package.json` and `selector/package.json`, moves `Unreleased` into a dated
  `## [X.Y.Z] - YYYY-MM-DD` section, and is squash-merged into `main`. CI checks versions and the
  changelog; `release.yml` then tags `vX.Y.Z`, publishes the GitHub release with that changelog
  section, and pushes the image as `X.Y.Z` and `latest`. Afterwards merge `main` back into `dev`
  if they diverged.
- **Cadence:** release when a coherent set of changes is done and verified on a running instance,
  at least every few weeks while there are changes; patch releases for fixes any time.
- **Versioning:** SemVer. Minor for features, patch for fixes, major when upgrading needs action
  from the operator (the changelog says what).

## Deployment

The reference deployment runs on Kubernetes (Flux) and pins a released image by tag and digest
(`ghcr.io/renplay-web/renplay:X.Y.Z@sha256:…`); Renovate proposes new releases. To try a `dev`
build there first, pin its `edge@sha256:…` digest temporarily, then pin the release. Data lives in
`/data` (a persistent volume, backed up); `/games` can be rebuilt from `/games/_archives`.

Agents never push to `main`, merge releases, or change a deployment on their own; they prepare
branches and pull requests and say what is left to do.

## Skills

Procedures for agents live in `.agents/skills/` (linked as `.claude/skills/`):

- `release`: cut a release (versions, changelog, PR, tag, image, deployment).
- `ui-check`: look at UI changes on a phone and a desktop before calling them done.
