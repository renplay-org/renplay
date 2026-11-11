---
title: How Renplay works
description: How installs, builds, the player and saves fit together.
---

Renplay turns the PC release of a Ren'Py game into a web build, serves it, and keeps the player's
saves on the server. This page explains the parts and why they are built the way they are. HTML
games take a shorter path through the same parts. [Engines](/engines/) covers them and the
engines still to come.

```
browser ── nginx :8080 ─┬─ /                      library UI (React, selector/dist)
                        ├─ /g/<id>/<build>/        game page, rendered from the engine's template
                        ├─ /g/<id>/<build>/game/…  streamed game files (from assets.pack)
                        ├─ /engine/<version>/…     shared Ren'Py web engine (gzip)
                        └─ /api/…                  node server on 127.0.0.1:3000
```

## The server

`services.ts` makes the server's parts once at start: the database, the adult level rules
(`content/mode.ts`), accounts, the catalog with its art cache, jobs, builds, engines and save backups.
Every router and job gets that one object. The person a request is for comes from the request
itself (`accounts/context.ts`), so `services.saves` is always the saves of whoever is asking.
Modules below the routes, like the install pipeline, take only the parts they use.

## Storage

| Path | Contents |
|---|---|
| `/downloads/` or `/games/_archives/` | Original downloads and drop folder. A writable `/downloads` wins unless `ARCHIVES_DIR` is set. Downloads are kept by default. Nothing is moved automatically. |
| `/games/<id>/<build>/` | One web build: `game.zip`, `assets.pack`, `assets.json`, `build.json`, `cache/` |
| `/games/<id>/<build>.m<hash>/` | A mod build: its own `game.zip` and caches. Everything else from the base build |
| `/games/_renplay/engines/<version>/` | Engine packs, downloaded on demand |
| `/games/_renplay/work/`, `purge/`, `uploads/` | Scratch space, deletions in progress, chunked uploads |
| `/data/library.db` | SQLite: games, jobs, settings, catalog cache, users, identities, hashed sessions and tokens, personal progress |
| `/data/job-logs/` | Recent job messages, appended as they happen so interrupted jobs keep their logs |
| `/data/users/<id>/saves/<save folder>/` | Each person's saves, including shared signing keys and HTML storage. History in `../save-history/` |
| `/data/saves/`, `/data/save-history/` | Compatibility symlinks to owner 1's folders |
| `/data/users-removed/` | Archived removed accounts. Never automatically purged |
| `/data/overlays/<id>/` | Mods: the user's files layered over a game |
| `/data/art/` | The art cache: made pictures by content hash, originals in `src/` (`art/store.ts`) |
| `/data/walkthroughs/` | Walkthrough PDFs |

`/data` is what to back up. Everything in `/games` except `_archives` can be rebuilt (from the
archives, while they are kept).

## Installing a game

`server/src/pipeline/import.ts` runs as a background job:

1. **Read the archive in place** (`archive.ts`): zip, 7z, rar or tar, without unpacking it to disk.
   Find the game folder and the Ren'Py version (`renpy/vc_version.py`). Other engines' games are
   recognized (`family.ts`) and refused with the reason. See [Engines](/engines/).
2. **Match the catalog** (`catalog/catalog.ts`): by sha256, name and size, or a `match` pattern. The recipe
   can choose the engine, files to keep or exclude, and small patches.
3. **Pick the engine** (`engines.ts`): the recipe's, `RENPLAY_ENGINE`, or the newest published
   engine of the game's major version. Games made with Ren'Py 7 or older get the newest Ren'Py 8
   engine, which loads their scripts. Only Python 2-only code fails. Engine packs come from
   renplay-org/engines and are checksum-verified.
4. **Split RPA archives** (`rpa.ts`) in one sequential pass. The archive index is a Python pickle.
   `util/pickle.ts` reads it as data only, so nothing from the game is executed.
5. **Optimize images** (`optimize.ts`): PNG and JPEG become WebP under the same names. Each
   streamed image gets a small placeholder. Image tasks reserve a slot before reading their input,
   and a shared pixel budget limits simultaneous decoding to 16 megapixels (16 × 1024² pixels).
   Inputs over 32 MiB or that pixel limit stay intact in `game.zip`, without a placeholder.
   Concurrency remains an upper bound. High-resolution images may run with fewer tasks at once.
   The container preloads jemalloc so glibc's allocator does not retain fragmented image-processing
   allocations across thousands of conversions. A library symlink resolves the platform's multiarch
   path on both amd64 and arm64.
6. **Decide what streams** (`progressive.ts`): images, audio and video stream on demand, everything
   the engine needs at start goes into `game.zip`. A developer's `progressive_download.txt` wins.
7. **Write the build**: streamed files are appended to `assets.pack` (with an `assets.json`
   index). `game.zip` (`assemble.ts`) holds the engine's Python package, the game's scripts and
   small files, the placeholders and the streaming list. The finished folder appears atomically.
   Script sources (`.rpy`) whose compiled `.rpyc` is there too go into the pack instead of
   `game.zip` (`setSourcesAside`), so Ren'Py loads the developer's compiled scripts: a `.rpyc`
   from another Ren'Py version looks stale to Ren'Py 8.5, which would compile the source again
   with a stricter parser and Python 3.12. Every build also gets `game/renplay_web.rpy`
   (`webcompat.ts`), stand-ins for what desktop games expect and a browser lacks (`ssl`, threads,
   Unix sockets, old import hooks, Python 2 print statements and octal numbers).
8. **Delete an uploaded archive** once the archive is closed (on NFS, deleting an open file
   leaves a hidden copy), only when **Keep downloads** is off. `RENPLAY_KEEP_DOWNLOADS` locks this
   choice when set. The deprecated `RENPLAY_DELETE_ARCHIVES` alias has the opposite value. The upload completion records
   the file identity separately from scan metadata. Copied, replaced, edited and unknown archives
   are never automatically deleted. Failed installs keep their archive.

Builds never change after that. A reinstall or update makes a new build. The old one is deleted in
the background by `util/purge.ts`.

Large files, including shared or multi-segment RPA entries and script sources moved aside, are
copied in chunks with pack-writer backpressure. Copying an engine or mod zip advances only after
its current entry has been consumed. RPA indexes are capped at 32 MiB compressed and 64 MiB
uncompressed. Archives with unreadable or oversized indexes are kept intact. File indexes and
small image placeholders still scale with the number of files, but file bodies are not queued.

Job logs (`jobs/logs.ts`) use synchronous appends under `/data/job-logs/`, with two files of at most
96 KiB per job. The log API returns the latest 96 KiB after a restart, even if the job never finished.
Jobs from before 2.11 have their log only in the database, and the log API still reads it. Clearing finished activity deletes
its log files. Startup removes any orphan files left by an interrupted cleanup.

### Why packs

On network storage every file creation is a round trip (100 to 250 ms on the reference NAS). A game
with 34,000 images took hours to write as loose files. As one pack it is a sequential write at
disk speed, and deleting a build is instant. The server serves pack entries with byte ranges, and nginx proxies those requests without buffering. Protected files use private,
no-store HTTP responses. The runtime separately caches shared build data in Cache Storage.

## Playing

The game page is the engine's own `index.html` with Renplay's runtime
(`runtime/renplay-runtime.js`, after `runtime/renplay-player.js`, which the HTML games' runtime
shares) injected. The server builds it at start and serves it at `/renplay/runtime.js`. The runtime:

- **Paces frames** to the display with `requestAnimationFrame`. Without it, Ren'Py's web build
  drew about 8 frames a second in tested games.
- **Loads the engine** compressed and keeps it in Cache Storage, so later starts skip the download.
- **Downloads `game.zip`** and resumes it with Range requests when the connection drops.
- **Keeps `~/.renpy` in memory** and syncs every write to the server (`/api/saves`). Other games'
  save folders are fetched on demand, which is how sequels find the previous season's saves.
- **Restores compiled caches**: Python bytecode before the engine starts, and scripts that Ren'Py
  recompiled (games made with an older Ren'Py) right after `game.zip` is unpacked. The first start
  uploads them. Later starts skip the compile.
- **Reports one loading progress** that only goes up (`loadingProgress`). The engine and `game.zip`
  are counted as their bytes arrive (renpy-pre.js keeps its own `game.zip` count private), then
  Ren'Py's own reports for unpacking and loading the scripts. Each step has a share of the bar.
- **Talks to the player** through `postMessage` (`renplay:*`): ready, progress, fullscreen,
  save and exit, load a slot, download the log, options, the controller.
- **Hands the controller to the player** for its Menu button: Start is taken out of Ren'Py's
  `config.pad_bindings` (again on each press, since a restarted game reads them anew), and while
  the drawer is open `navigator.getGamepads` answers empty, until every button is released after it
  closes.

The player (`selector/src/pages/Player.tsx`) sizes the game from the stage's real size and the
device's safe-area insets (`frameRect` in `lib/display.ts`: Fit gives the frame the game's own
shape, Fill crops only the sides), handles fullscreen (the Fullscreen API, or Add to Home Screen on
iPhone), and offers saves, a walkthrough and display options. Outside a game, `lib/gamepad.ts` turns
the d-pad into arrow keys for the focus engine (`lantern/focus.ts`).

### Offline

`selector/public/sw.js` is Renplay's service worker. Online, pages and answers come from the server
first. With a copy at hand, a server that does not answer in 6 seconds, or answers 5xx, counts as
unreachable.

- **The library** (`index.html`, the content-hashed `/assets/`) and a few answers (`/api/me`, the
  games, a game, the defaults) are kept for a library that opens offline. Saves are never cached:
  the runtime's own queue keeps them in IndexedDB and sends them with the conflict rule.
- **A kept game** lives in `renplay-offline-<id>` (its page, the runtime, the engine, the build's
  files and every streamed file listed by `GET /api/games/:id/offline`), and its `game.zip` in the
  runtime's own cache. Byte ranges are sliced from the cached files for videos.
- **The game page offline** is the kept copy with `userId` written over from the saved `/api/me`, so
  the game keeps each person's unsent saves apart on a shared browser. Without a signed-in person,
  or for a game that person never opened online, it does not play. At Blurred the game's presplash
  gives way to the engine's.
- `lib/offline.ts` downloads a few files at a time, resumes with Range requests, checks
  `navigator.storage.estimate()` first and asks for persistent storage.

## Saves

`server/src/saves/store.ts` has one instance per account, under `/data/users/<id>/saves/`, laid out
like desktop Ren'Py. `saves/stores.ts` makes them and owns where they live, and the names, notes and
pins people give their saves. Every overwrite and delete snapshots the previous version in that
account's `save-history/`. Locks are shared across store instances. Metadata keys include the store root.
Renplay never deletes saves on uninstall or reinstall. See [Accounts API](/developers/accounts-api/)
for schema 7, migration, sessions, nginx protection and the request-local permission boundary.

## The catalog

`catalog/catalog.ts` fetches the index (`index.v4.json`, catalog schema 4, and `normalizeRecipe` also reads
schemas 2 and 3, turning a schema 3 cover into a grid) every hour (or from Settings). It links
installed games to recipes (by id, archive or save folder) and reports newer working releases as
updates. Library metadata (title, developer, tags, links, summary and game state) comes only from
recipes. Art comes from recipes too, and a person or an admin can choose another picture.

The cache stores recipes and the tag vocabulary together for offline starts. Vocabulary entries
from multiple indexes merge in configured order, with the first definition winning.
`GET /api/catalog` exposes it as `vocabulary: { [tagId]: { label, group } }`. Recipes retain
`tagIds`, `content`, `state` and `summary`; legacy `tags` labels still work without a vocabulary.
Game JSON returns empty arrays for missing `tagIds`/`content` and null for missing `state`/`summary`.
Content tags are not library chips. Display `version` uses the release matched by the installed
archive's file name, then by version equality, and `detectedVersion` keeps the raw detected value.
The same release determines playability status and available updates.

## Library preferences and activity

Library search, installation filter, tags and sort live in URL query parameters (`q`, `filter`,
`tag` as a comma separated list, `sort`), so returning from a game page restores the view. The list
follows the typed text at once and the address follows after a pause, replacing the entry rather than
adding one. Matching and ranking are in `selector/src/lib/search.ts`: uFuzzy finds the words and our
tiers order them, so a title beats a developer and a developer beats a tag. Recently added sorts by the
library entry's `createdAt`, not the installation date. Library pages reveal 60 games initially,
then 48 at a time. Catalog pages reveal 30 at a time. Tag chips count the games shown now, keep the order of the most common tags over all games, include only play
and story tags shared by at least two games, and use the catalog vocabulary for labels.

Each person's progress (favourite, status, rating, play time, last played) lives in `user_games`,
independently of builds, and their play sessions in `play_sessions`. Both belong to
`progress/store.ts`, and their routes to `progress/routes.ts`.
`PUT /api/games/:id/favorite` accepts `{ "on": boolean }` and returns `{ ok, game }`.
Game JSON exposes `favoriteAt` as an ISO timestamp or null. Setting an existing favourite keeps
its timestamp. Uninstall keeps it. Forgetting the library entry removes it.

Schema 5 adds `games.finished_at` (ISO timestamp or empty) and `games.play_time` (seconds,
initially zero). The migration is transactional and changes no save files. Uninstall and rebuilds
keep both fields. Removing the library entry removes them, but not saves.
`PUT /api/games/:id/finished` accepts `{ "on": boolean }`, preserves an existing timestamp and
returns `{ ok, game }`. Finished stories stay in the library but leave Up next.
`POST /api/games/:id/play-time` accepts `{ "seconds": integer }` from 1 to 60 and atomically adds
that interval. The player samples visible, ready time, reports every 15 seconds, and flushes the
remainder on hiding, exit or unmount with a keepalive request. Hidden tabs, loading and failures
are not counted. Time starts at this upgrade rather than being inferred from overlapping save
slots. A lost network report can undercount time, but never changes saves.

Game JSON includes `playTime`, `finishedAt`, and `latestSave` (file, Ren'Py label, name, creation
time in milliseconds, optional runtime in seconds, and screenshot URL, or null). Library and
save-gallery metadata share a bounded cache keyed by store root, folder, filename, mtime and size.
A changed or deleted save is reflected on the next list. Up next uses the newest played installed,
non-finished game and invalidates on player exit.

The empty library's starter is the first Ren'Py recipe with `free: true` that is not `nsfw` and
has a working release. Without one it shows no starter.

**Adult levels** (`content/mode.ts`). A request's level is the lowest of the installation's, the
person's ceiling, the person's choice and this device's. The interface shows a person one choice
(`AdultChoice` on the account page) with the levels above their limit struck through. The browser keeps the device level in
`localStorage` (`renplay:adult-device`, for everyone using that browser) and sends it as the
`X-Renplay-Adult` header on API calls. The game page, an iframe, gets it as `?adult=` in `playUrl`.
A device value can only narrow, so the server trusts it. It is enforced on every API answer, so a
page below the device level never holds an adult picture's address. Requests a browser makes on its
own (pictures, files nginx serves, the assets of HTML games) carry no header and are checked at the
person's level. At Off an adult game is left out of every
answer and every route addressed to it answers 404: games, files, saves, jobs (also jobs with only
a download or a recipe), downloads, the Users tools, counts and catalog problems. At Blurred the game
is listed and plays, with its walkthrough and the person's own save files, but no picture of it is
sent: no art URL in JSON (each format is its ThumbHash and tint), 404 for art, save screenshots and the build's presplash, directly and
through nginx's `/api/auth/check`. `adult-levels.test.ts` lists every registered route with what
the levels do on it, so a new route fails until it is classified.

`GET /api/jobs` retains `jobs` and `busy` and adds `total`. It accepts `limit` (default 30,
clamped to 1 to 200) and `offset` (default 0). Invalid or unsafe integers use the defaults.
Jobs sort running first, then the waiting ones (queued or paused) in the order they will run, then
the finished, newest first, with the id breaking timestamp ties. Offset pages reflect the current
queue. Running jobs can move between pages as their status changes. A job that was retried gives
way to its retry, which carries `attempts` (the chain of `retry_of`, so a mod added, a mod removed
and a mod build of one game are three jobs of one attempt each) and `title` (the library's game or
the recipe the archive matched, null when no game is known).

`POST /api/jobs/:id/pause` holds a queued job back, or stops a running one the way a cancel does
and returns it to the front of the queue as `paused`. `POST /api/jobs/:id/resume` queues it again,
and it starts from its parameters: an install reads its archive again, since a build only appears
once it is whole. `POST /api/jobs/:id/move` with `{ "to": "up" | "down" | "first" }` reorders a
waiting job. The order (`position`) and the paused state are in the library, so a restart keeps
them. All three are admin only, and a job about a game that does not exist for the admin answers 404.

**Art** (`art/store.ts`). A game has five formats: grid 600x900, wide 920x430, hero 1920x620, a logo and
a square icon. For each, the chosen picture is a person's choice, else the admin's for everyone
(`art_choices`, scope 0), else the catalog's default. `planFormat` decides how a format is made:
real art in the shape is resized. Another shape is cropped around its focal point when the recipe
gives one or when the crop keeps 60 percent (else sharp's attention guess), and a crop from a
picture of another format enlarges it at most 2.25 times (`MAX_ENLARGE`). Otherwise a wide from a
poster puts the poster at the left on its glow, a grid from a wide picture puts it across the upper
half, a missing hero is a glow of the picture's colours (made from a copy 1/48 of the size, so no
shape is left to smear), and anything else is the picture whole on its glow. The icon is cut from the grid (62 percent of its short side). Logos are never made. Each
original is downloaded once into `/data/art/src/<sha256>` and checked against the index. Made
pictures are WebP at 1x, and at 2x only when the source has 1.5 pixels per 1x pixel, named by their
content and recorded in `art_made` with a ThumbHash and a tint (the catalog build's method). The
key of a made picture is its source, method and focal point, so a change of either makes a new one.
`sync()` runs after each catalog refresh and at start: it makes every format of every recipe and
library game for everyone and for each person who chose something, then forgets made pictures and
originals nothing uses. A request that finds a format not made yet gets the source's hash and the
format is made in the background. `/api/art/<file>` and nginx's location serve made pictures only,
with a year of private caching, after the same level check. Uploads (`art_uploads`) stay in the
instance's cache.

## Mods

`games/mods.ts` keeps the user's files in `/data/overlays/<id>/`. Applying mods (`applymods.ts`) builds a
new `game.zip` from the base build plus the overlay into `<build>.m<hash>/`; streamed files still
come from the base build's pack. Updating a game can re-apply mods or move them aside.

## Adult games

`content/levels.ts` holds the three levels, Off, Blurred and Shown, and `content/mode.ts` applies them. The installation's level is
`RENPLAY_ADULT_GAMES=off|blurred|shown` when set (it locks it, and `allow` and `block` still mean
Shown and Off), else the `adult_level` setting, else Shown until the owner answers the one question
in the empty library (`GET`/`PUT /api/content`). Each person has a ceiling, set by an admin, by a
sign-in group, or `RENPLAY_ADULT_DEFAULT` for new people, and their own choice. A request's level is
the lowest of these and the browser's (see Adult levels above).

At Off adult games are left out where the data enters and where it leaves:

- **Catalog.** Each configured URL is read from its safe-for-work sibling (`index.v4.json` becomes
  `index.v4.sfw.json`). If that is missing, the full index is fetched and its adult recipes and
  content tags are dropped, with a log line. Adult recipes are never cached at Off, and the next art
  sync forgets their pictures. Below Shown no adult picture is downloaded. Only a stub is kept per
  known adult recipe (id, archive names, sizes and checksums, save folder, no title, tags or art), so that
  `match()` can recognize its archive: `POST /api/imports` and the install job refuse it with a plain
  reason, and `GET /api/archives` marks it `blocked`.
- **Library.** `games.adult` remembers, from the last catalog that knew the recipe, which games are
  adult. At Off, `ContentMode.hides` makes the games list leave them out and every route that names
  one (game, saves, files, play pages and streamed assets, copy targets, jobs, the saves export)
  answer 404. Nothing is deleted, and a higher level shows them again. A game without a recipe
  counts as adult for a person at Off until an admin marks it safe.
- **Blurred.** No picture of an adult game is downloaded at the installation's Blurred, and none is
  sent to a person at Blurred: the API gives formats as a ThumbHash and a tint, with no address, save
  pictures as `screenshotHash`, and the presplash stays out of the game page.
- **Static files.** nginx's server-level `auth_request` checks art, walkthroughs and build files
  too. Successful permission checks have a 60-second cache. Proxied routes check in Node. Public
  engines, the runtime, UI and health remain open.

## People on a shared browser

**PINs** (`accounts/accounts.ts`). A person's PIN is hashed with scrypt like a password (`users.pin_hash`). Each
browser has a `renplay_device` cookie of its own, stored hashed, that outlives sign-out, and every
sign-in records the person against it (`device_people`). **Who is playing?** lists and switches to
only those people. A switch counts its try before the PIN is checked, so tries sent at once cannot
get past the limit of five. A missing person, an admin and a wrong PIN all get the same answer after
the same wait. Revoking a person's sessions clears their PIN and their entries on other browsers.

**Defaults for everyone** live in the settings table (`defaults_for_everyone`). `/api/me/tags`
answers the admin's tags until the person saves their own. The player sends the defaults with each
`renplay:options` message, and the runtime applies Rollback, Skip and the text size until the
person chooses (their choice and a size-chosen flag live in the game's persistent data). The
admin's text size is applied once each time it changes, so the game's own setting keeps working.

## Security notes

- Game code never runs on the server: no Ren'Py SDK, no Python. Archives are parsed as data.
- Every path from a request or an archive goes through `util/paths.ts` (`cleanRelPath`,
  `safeJoin`), which rejects traversal.
- The container runs as a non-root user with a read-only root filesystem.
- Local accounts separate saves and restrict management to admins. Use HTTPS outside a trusted
  network. Proxy hop counts, CSRF, hashed credentials and sessions, and sandboxed HTML asset URLs
  are documented in [Accounts API](/developers/accounts-api/).
