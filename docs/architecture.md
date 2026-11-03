# How Renplay works

Renplay turns the PC release of a Ren'Py game into a web build, serves it, and keeps the player's
saves on the server. This page explains the parts and why they are built the way they are.

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
| `/games/_archives/` | Original game archives: the drop folder and the source for reinstalls |
| `/games/<id>/<build>/` | One web build: `game.zip`, `assets.pack`, `assets.json`, `build.json`, `cache/` |
| `/games/<id>/<build>.m<hash>/` | A mod build: its own `game.zip` and caches; everything else from the base build |
| `/games/_renplay/engines/<version>/` | Engine packs, downloaded on demand |
| `/games/_renplay/work/`, `purge/`, `uploads/` | Scratch space, deletions in progress, chunked uploads |
| `/data/library.db` | SQLite: games, jobs, settings, the catalog cache |
| `/data/saves/<save folder>/` | Saves, exactly as desktop Ren'Py lays them out, with `/data/save-history/` |
| `/data/overlays/<id>/` | Mods: the user's files layered over a game |
| `/data/covers/` | Covers downloaded from the catalog (content-hashed names) |
| `/data/walkthroughs/` | Walkthrough PDFs |

`/data` is what to back up. Everything in `/games` except `_archives` can be rebuilt.

## Installing a game

`server/src/pipeline/import.ts` runs as a background job:

1. **Read the archive in place** (`archive.ts`): zip, 7z, rar or tar, without unpacking it to disk.
   Find the game folder and the Ren'Py version (`renpy/vc_version.py`).
2. **Match the catalog** (`catalog.ts`): by sha256, name and size, or a `match` pattern. The recipe
   can choose the engine, files to keep or exclude, and small patches.
3. **Pick the engine** (`engines.ts`): the recipe's, `RENPLAY_ENGINE`, or the newest published
   engine of the game's major version. Engine packs come from renplay-web/engines and are
   checksum-verified.
4. **Split RPA archives** (`rpa.ts`) in one sequential pass. The archive index is a Python pickle;
   `util/pickle.ts` reads it as data only, so nothing from the game is executed.
5. **Optimize images** (`optimize.ts`): PNG and JPEG become WebP under the same names; each
   streamed image gets a small placeholder.
6. **Decide what streams** (`progressive.ts`): images, audio and video stream on demand, everything
   the engine needs at start goes into `game.zip`. A developer's `progressive_download.txt` wins.
7. **Write the build**: streamed files are appended to `assets.pack` (with an `assets.json`
   index); `game.zip` (`assemble.ts`) holds the engine's Python package, the game's scripts and
   small files, the placeholders and the streaming list. The finished folder appears atomically.

Builds never change after that. A reinstall or update makes a new build; the old one is deleted in
the background by `util/purge.ts`.

### Why packs

On network storage every file creation is a round trip (100–250 ms on the reference NAS). A game
with 34,000 images took hours to write as loose files; as one pack it is a sequential write at
disk speed, and deleting a build is instant. The server serves pack entries with byte ranges and
immutable caching; nginx proxies those requests without buffering.

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

`server/src/saves/store.ts` stores files under `/data/saves/<save folder>/`, exactly as desktop
Ren'Py does, so exports work with desktop Ren'Py and imports from it need no conversion. Every
overwrite and delete moves the previous version to `/data/save-history/`. Renplay never deletes
saves on uninstall or reinstall.

## The catalog

`catalog.ts` fetches the index every 6 hours (or from Settings). It links installed games to
recipes (by id, archive or save folder) and reports newer working releases as updates. Library
metadata (title, developer, tags, links, cover) comes only from recipes.

Covers are the games' official cover art, linked by the catalog from the developers' own hosting
(itch.io, Steam) with a sha256. Renplay downloads each one once, refuses it if the checksum
differs, and keeps a WebP thumbnail (at most 960 pixels wide) in `/data/covers` under a
content-hashed name.

## Mods

`mods.ts` keeps the user's files in `/data/overlays/<id>/`. Applying mods (`applymods.ts`) builds a
new `game.zip` from the base build plus the overlay into `<build>.m<hash>/`; streamed files still
come from the base build's pack. Updating a game can re-apply mods or move them aside.

## Security notes

- Game code never runs on the server: no Ren'Py SDK, no Python; archives are parsed as data.
- Every path from a request or an archive goes through `util/paths.ts` (`cleanRelPath`,
  `safeJoin`), which rejects traversal.
- The container runs as a non-root user with a read-only root filesystem.
- Renplay has no accounts; put it behind your own authentication if it is reachable from outside.
