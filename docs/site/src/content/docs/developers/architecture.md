---
title: How Renplay works
description: How installs, builds, the player and saves fit together.
---

Renplay turns the PC release of a Ren'Py game into a web build, serves it, and keeps the player's
saves on the server. This page explains the parts and why they are built the way they are. HTML
games take a shorter path through the same parts; [Engines](/engines/) covers them and the
engines still to come.

```
browser ── nginx :8080 ─┬─ /                      library UI (React, selector/dist)
                        ├─ /g/<id>/<build>/        game page, rendered from the engine's template
                        ├─ /g/<id>/<build>/game/…  streamed game files (from assets.pack)
                        ├─ /engine/<version>/…     shared Ren'Py web engine (gzip)
                        └─ /api/…                  node server on 127.0.0.1:3000
```

## Storage

| Path | Contents |
|---|---|
| `/games/_archives/` | Original game archives: the drop folder. Deleted after a successful install unless `RENPLAY_DELETE_ARCHIVES=false`, which keeps them as the source for reinstalls |
| `/games/<id>/<build>/` | One web build: `game.zip`, `assets.pack`, `assets.json`, `build.json`, `cache/` |
| `/games/<id>/<build>.m<hash>/` | A mod build: its own `game.zip` and caches; everything else from the base build |
| `/games/_renplay/engines/<version>/` | Engine packs, downloaded on demand |
| `/games/_renplay/work/`, `purge/`, `uploads/` | Scratch space, deletions in progress, chunked uploads |
| `/data/library.db` | SQLite: games, jobs, settings, catalog cache, users, identities, hashed sessions and tokens, personal progress |
| `/data/job-logs/` | Recent job messages, appended as they happen so interrupted jobs keep their logs |
| `/data/users/<id>/saves/<save folder>/` | Each person's saves, including shared signing keys and HTML storage; history in `../save-history/` |
| `/data/saves/`, `/data/save-history/` | Compatibility symlinks to owner 1's folders |
| `/data/users-removed/` | Archived removed accounts; never automatically purged |
| `/data/overlays/<id>/` | Mods: the user's files layered over a game |
| `/data/covers/` | Covers downloaded from the catalog (content-hashed names) |
| `/data/walkthroughs/` | Walkthrough PDFs |

`/data` is what to back up. Everything in `/games` except `_archives` can be rebuilt (from the
archives, while they are kept).

## Installing a game

`server/src/pipeline/import.ts` runs as a background job:

1. **Read the archive in place** (`archive.ts`): zip, 7z, rar or tar, without unpacking it to disk.
   Find the game folder and the Ren'Py version (`renpy/vc_version.py`). Other engines' games are
   recognized (`family.ts`) and refused with the reason; see [Engines](/engines/).
2. **Match the catalog** (`catalog.ts`): by sha256, name and size, or a `match` pattern. The recipe
   can choose the engine, files to keep or exclude, and small patches.
3. **Pick the engine** (`engines.ts`): the recipe's, `RENPLAY_ENGINE`, or the newest published
   engine of the game's major version. Games made with Ren'Py 7 or older get the newest Ren'Py 8
   engine, which loads their scripts; only Python 2-only code fails. Engine packs come from
   renplay-org/engines and are checksum-verified.
4. **Split RPA archives** (`rpa.ts`) in one sequential pass. The archive index is a Python pickle;
   `util/pickle.ts` reads it as data only, so nothing from the game is executed.
5. **Optimize images** (`optimize.ts`): PNG and JPEG become WebP under the same names; each
   streamed image gets a small placeholder. Image tasks reserve a slot before reading their input,
   and a shared pixel budget limits simultaneous decoding to 16 megapixels (16 × 1024² pixels).
   Inputs over 32 MiB or that pixel limit stay intact in `game.zip`, without a placeholder.
   Concurrency remains an upper bound; high-resolution images may run with fewer tasks at once.
   The container preloads jemalloc so glibc's allocator does not retain fragmented image-processing
   allocations across thousands of conversions. A library symlink resolves the platform's multiarch
   path on both amd64 and arm64.
6. **Decide what streams** (`progressive.ts`): images, audio and video stream on demand, everything
   the engine needs at start goes into `game.zip`. A developer's `progressive_download.txt` wins.
7. **Write the build**: streamed files are appended to `assets.pack` (with an `assets.json`
   index); `game.zip` (`assemble.ts`) holds the engine's Python package, the game's scripts and
   small files, the placeholders and the streaming list. The finished folder appears atomically.
   Script sources (`.rpy`) whose compiled `.rpyc` is there too go into the pack instead of
   `game.zip` (`setSourcesAside`), so Ren'Py loads the developer's compiled scripts: a `.rpyc`
   from another Ren'Py version looks stale to Ren'Py 8.5, which would compile the source again
   with a stricter parser and Python 3.12. Every build also gets `game/renplay_web.rpy`
   (`webcompat.ts`), stand-ins for what desktop games expect and a browser lacks (`ssl`, threads,
   Unix sockets, old import hooks, Python 2 print statements and octal numbers).
8. **Delete the archive** once the archive is closed (on NFS, deleting an open file leaves a
   hidden copy), unless `RENPLAY_DELETE_ARCHIVES=false`. Failed installs keep it.

Builds never change after that. A reinstall or update makes a new build; the old one is deleted in
the background by `util/purge.ts`.

Large files, including shared or multi-segment RPA entries and script sources moved aside, are
copied in chunks with pack-writer backpressure. Copying an engine or mod zip advances only after
its current entry has been consumed. RPA indexes are capped at 32 MiB compressed and 64 MiB
uncompressed; archives with unreadable or oversized indexes are kept intact. File indexes and
small image placeholders still scale with the number of files, but file bodies are not queued.

Job logs (`joblogs.ts`) use synchronous appends under `/data/job-logs/`, with two files of at most
96 KiB per job. The log API returns the latest 96 KiB after a restart, even if the job never finished.
Finished jobs also retain their database log for compatibility. Clearing finished activity deletes
its log files; startup removes any orphan files left by an interrupted cleanup.

### Why packs

On network storage every file creation is a round trip (100–250 ms on the reference NAS). A game
with 34,000 images took hours to write as loose files; as one pack it is a sequential write at
disk speed, and deleting a build is instant. The server serves pack entries with byte ranges; nginx proxies those requests without buffering. Protected files use private,
no-store HTTP responses; the runtime separately caches shared build data in Cache Storage.

## Playing

The game page is the engine's own `index.html` with Renplay's runtime
(`runtime/renplay-runtime.js`) injected. The runtime:

- **Paces frames** to the display with `requestAnimationFrame`. Without it, Ren'Py's web build
  drew about 8 frames a second in tested games.
- **Loads the engine** compressed and keeps it in Cache Storage, so later starts skip the download.
- **Downloads `game.zip`** and resumes it with Range requests when the connection drops.
- **Keeps `~/.renpy` in memory** and syncs every write to the server (`/api/saves`). Other games'
  save folders are fetched on demand, which is how sequels find the previous season's saves.
- **Restores compiled caches**: Python bytecode before the engine starts, and scripts that Ren'Py
  recompiled (games made with an older Ren'Py) right after `game.zip` is unpacked. The first start
  uploads them; later starts skip the compile.
- **Talks to the player** through `postMessage` (`renplay:*`): ready, progress, fullscreen,
  save and exit, load a slot, download the log.

The player (`selector/src/pages/Player.tsx`) sizes the game from the stage's real size and the
device's safe-area insets, handles fullscreen (the Fullscreen API, or Add to Home Screen on
iPhone), and offers saves, a walkthrough and display options.

## Saves

`server/src/saves/store.ts` has one instance per account, under `/data/users/<id>/saves/`, laid out
like desktop Ren'Py. Every overwrite and delete snapshots the previous version in that account's
`save-history/`. Locks are shared across store instances; metadata keys include the store root.
Renplay never deletes saves on uninstall or reinstall. See [Accounts API](/developers/accounts-api/)
for schema 7, migration, sessions, nginx protection and the request-local permission boundary.

## The catalog

`catalog.ts` fetches the index (`index.v3.json`, catalog schema 3; `normalizeRecipe` also reads
schema 2) every hour (or from Settings). It links installed games to
recipes (by id, archive or save folder) and reports newer working releases as updates. Library
metadata (title, developer, tags, links, cover, summary and game state) comes only from recipes.

The cache stores recipes and the tag vocabulary together for offline starts. Vocabulary entries
from multiple indexes merge in configured order, with the first definition winning.
`GET /api/catalog` exposes it as `vocabulary: { [tagId]: { label, group } }`. Recipes retain
`tagIds`, `content`, `state` and `summary`; legacy `tags` labels still work without a vocabulary.
Game JSON returns empty arrays for missing `tagIds`/`content` and null for missing `state`/`summary`.
Content tags are not library chips. Display `version` uses the release matched by the installed
archive's file name, then by version equality; `detectedVersion` keeps the raw detected value.
The same release determines playability status and available updates.

## Library preferences and activity

Library search, installation filter, tag and sort live in URL query parameters (`q`, `filter`,
`tag`, `sort`), so returning from a game page restores the view. Recently added sorts by the
library entry's `createdAt`, not the installation date. Library pages reveal 60 games initially,
then 48 at a time; catalog pages reveal 30 at a time. Tag chips count games, include only play
and story tags shared by at least two games, and use the catalog vocabulary for labels.

Favourites first lived in `games.favorite_at` (schema 4). Schema 7 copies owner progress into
`user_games` and all account-facing progress reads and writes use that table, independently of builds.
The shared `games.last_played_at` remains the latest across accounts for downgrade compatibility.
`PUT /api/games/:id/favorite` accepts `{ "on": boolean }` and returns `{ ok, game }`.
Game JSON exposes `favoriteAt` as an ISO timestamp or null. Setting an existing favourite keeps
its timestamp. Uninstall keeps it; forgetting the library entry removes it.

Schema 5 adds `games.finished_at` (ISO timestamp or empty) and `games.play_time` (seconds,
initially zero). The migration is transactional and changes no save files. Uninstall and rebuilds
keep both fields; removing the library entry removes them, but not saves.
`PUT /api/games/:id/finished` accepts `{ "on": boolean }`, preserves an existing timestamp and
returns `{ ok, game }`. Finished stories stay in the library but leave Up next.
`POST /api/games/:id/play-time` accepts `{ "seconds": integer }` from 1 to 60 and atomically adds
that interval. The player samples visible, ready time, reports every 15 seconds, and flushes the
remainder on hiding, exit or unmount with a keepalive request. Hidden tabs, loading and failures
are not counted. Time starts at this upgrade rather than being inferred from overlapping save
slots; a lost network report can undercount time, but never changes saves.

Game JSON includes `playTime`, `finishedAt`, and `latestSave` (file, Ren'Py label, name, creation
time in milliseconds, optional runtime in seconds, and screenshot URL, or null). Library and
save-gallery metadata share a bounded cache keyed by store root, folder, filename, mtime and size;
a changed or deleted save is reflected on the next list. Up next uses the newest played installed,
non-finished game and invalidates on player exit.

Optional catalog `free` and `cover.sfw` are additive to schema 3. The API keeps its existing cover
URL field and exposes `coverSfw` alongside it, including on archive matches. Safe covers are
allowed while adult save screenshots remain hidden. The empty library's starter is the first
Ren'Py recipe with `free: true` that is not `nsfw` and has a working release; without one it shows
no starter. Account preference `adultPictures` defaults to `hide-pictures`; `show` and `hide-games`
are the other values. Device overrides use `renplay:adult-pictures:<user id>`. A device cannot grant
adult access the account lacks. Hidden art is not requested.

`GET /api/jobs` retains `jobs` and `busy` and adds `total`. It accepts `limit` (default 30,
clamped to 1–200) and `offset` (default 0). Invalid or unsafe integers use the defaults.
Jobs sort active first, then newest first, with the id breaking timestamp ties. Offset pages
reflect the current queue; running jobs can move between pages as their status changes.

Covers are the games' official cover art, linked by the catalog from the developers' own hosting
(itch.io, Steam) with a sha256. Renplay downloads each one once, refuses it if the checksum
differs, and keeps a WebP thumbnail (at most 960 pixels wide) in `/data/covers` under a
content-hashed name.

## Mods

`mods.ts` keeps the user's files in `/data/overlays/<id>/`. Applying mods (`applymods.ts`) builds a
new `game.zip` from the base build plus the overlay into `<build>.m<hash>/`; streamed files still
come from the base build's pack. Updating a game can re-apply mods or move them aside.

## Adult games

`content.ts` holds the install-wide switch: `RENPLAY_ADULT_GAMES=allow|block` locks it, otherwise the
`adult_games` setting does. Database version 6 stores `allow` for a library that already existed, so
upgrading changes nothing; a fresh install has no answer, blocks, and asks once in the empty library
(`GET`/`PUT /api/content` returns `{ adultGames, locked, chosen }`).

Blocking is done where the data enters and where it leaves:

- **Catalog.** Each configured URL is read from its safe-for-work sibling (`index.v3.json` becomes
  `index.v3.sfw.json`). If that is missing, the full index is fetched and its adult recipes and
  content tags are dropped, with a log line. Adult recipes and covers are never cached; switching to
  block deletes the ones cached and the cached covers. Only a stub is kept per known adult recipe
  (id, archive names, sizes and checksums, save folder, no title, tags or cover), so that
  `match()` can recognize its archive: `POST /api/imports` and the install job refuse it with a plain
  reason, and `GET /api/archives` marks it `blocked`.
- **Library.** `games.adult` remembers, from the last catalog that knew the recipe, which games are
  adult. While blocked, `ContentMode.hides` makes the games list leave them out and every route that
  names one (game, saves, files, play pages and streamed assets, copy targets, jobs, the saves export)
  answer 404. Nothing is deleted; switching back to allow shows them again. A game without a recipe
  is not hidden.
- **Account access.** Schema 7 adds admin-set adult access (blocked by default for new users),
  enforced in the catalog, games, save tree, exports and play routes. Unknown games count as adult
  for restricted users unless an admin marks one safe. Account preference Hide adult games narrows
  this further; Hide pictures is cosmetic, not access control.
- **Static files.** nginx's server-level `auth_request` checks covers, walkthroughs and build files
  too. Successful permission checks have a 60-second cache. Proxied routes check in Node; public
  engines, the runtime, UI and health remain open.

## Security notes

- Game code never runs on the server: no Ren'Py SDK, no Python; archives are parsed as data.
- Every path from a request or an archive goes through `util/paths.ts` (`cleanRelPath`,
  `safeJoin`), which rejects traversal.
- The container runs as a non-root user with a read-only root filesystem.
- Local accounts separate saves and restrict management to admins. Use HTTPS outside a trusted
  network. Proxy hop counts, CSRF, hashed credentials and sessions, and sandboxed HTML asset URLs
  are documented in [Accounts API](/developers/accounts-api/).
