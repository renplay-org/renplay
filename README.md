# renplay

**A self-hosted library for Ren’Py games that play in the browser.** Drop in the normal PC
download of a game; renplay unpacks it, optimizes it, builds it for the web and keeps your saves
on the server, so you can continue on any device.

- **Saves live on the server.** Every save, autosave and persistent change is uploaded the moment
  the game writes it. Previous versions are kept. All games share one save tree like desktop
  Ren’Py does, so sequels can import the previous season’s saves. Import and export saves from
  and to the desktop version, and copy a save from one game to another.
- **One-click installs from archives.** zip, 7z or rar. RPA archives are split while streaming
  (no extra scratch space), images are converted to WebP (same file names, typically 3–10×
  smaller), and renplay assembles the web build itself: no Ren’Py SDK, and the game’s code never
  runs on the server. Uninstall frees the space and keeps saves and mods; reinstall rebuilds from
  the stored archive.
- **Shared engines on demand.** Games run on the official Ren’Py web engine, packaged per version
  in [renplay-web/engines](https://github.com/renplay-web/engines). An engine is downloaded the
  first time a game needs it (checksum-verified), shared by all games of that version, and
  removed when none uses it.
- **Fast to play.** The Ren’Py engine is shared and downloaded once for all games, game data is
  cached in the browser, every build has versioned URLs so assets are cached forever, and
  everything else streams on demand. **Resume** loads your latest save straight away.
- **Mods.** Browse a game’s files, edit scripts in the browser, upload files or a mod zip. Your
  changes are kept as a separate layer, compiled and applied on top of the game; updates warn
  you and can re-apply them.
- **Curated catalog.** [renplay-web/catalog](https://github.com/renplay-web/catalog) lists games
  known to work: the exact archive, the engine version, and the few settings a game may need. No
  game files are hosted there. **Export recipe** on a game's Details tab fills one in for a pull
  request.

## Run it

```bash
docker run -d -p 8080:8080 \
  -v /path/to/games:/games \
  -v /path/to/data:/data \
  ghcr.io/renplay-web/renplay:edge
```

Open http://localhost:8080, copy a game’s PC download into `/path/to/games/_archives/` (or upload
it in the UI) and press Install. The first install downloads the Ren’Py web engine (~16 MB).

| Path | Contents |
|------|----------|
| `/games/<game>/<build>/` | Installed web builds (served as static files) |
| `/games/_archives/` | Original game archives (drop folder and reinstall source) |
| `/games/_renplay/` | Engines, build scratch space, deletions in progress |
| `/data/` | Database, saves and their history, mods, covers, walkthroughs |

Back up `/data`; everything in `/games` can be rebuilt from the archives.

### Configuration

| Variable | Default | |
|---|---|---|
| `GAMES_DIR` | `/games` | Game builds |
| `DATA_DIR` | `/data` | Database, saves, mods |
| `ARCHIVES_DIR` | `$GAMES_DIR/_archives` | Source archives |
| `RENPLAY_DIR` | `$GAMES_DIR/_renplay` | Engines, scratch (same filesystem as `GAMES_DIR`) |
| `RENPLAY_ENGINES_URL` | `https://renplay-web.github.io/engines/index.json` | Engine index |
| `RENPLAY_ENGINE` | newest of the game's major version | Pin every build to one engine version |
| `RENPLAY_IMAGE_QUALITY` | `88` | WebP quality |
| `RENPLAY_IMAGE_CONCURRENCY` | CPU count | Parallel image conversions |
| `RENPLAY_CATALOG_URLS` | `https://renplay-web.github.io/catalog/index.json` | Comma-separated catalog indexes |
| `RENPLAY_KEEPALIVE_URL`, `RENPLAY_KEEPALIVE_HOST` | – | For scale-to-zero setups: while a job runs, the server holds a request open through this proxy URL so it is not scaled down |

The container runs as any non-root user and works with a read-only root filesystem (it writes to
`/tmp`, `/data` and `/games`).

## How it works

```
browser ── nginx :8080 ── /            library UI (React)
                     ├── /g/<game>/<build>/…   game files from /games (immutable)
                     ├── /engine/<id>/…        shared Ren’Py web engine (gzip)
                     └── /api/…                node server (127.0.0.1:3000)
```

- **Builds** (`server/src/pipeline`): `archive.ts` reads zips without extracting them, `rpa.ts`
  splits Ren’Py archives in one sequential pass using a data-only pickle reader
  (`util/pickle.ts`; nothing from the archive is executed), `optimize.ts` converts images with
  libvips, and `assemble.ts` writes the web build the way Ren’Py’s launcher does: streamed files
  stay loose, everything else goes into `game.zip` with the engine’s Python package, WebP
  placeholders and the streaming list. A build lives in `/games/<game>/<build>/` and never
  changes; updates and mods create a new one. Mod builds hold only their own `game.zip`.
- **Runtime** (`runtime/renplay-runtime.js`) is injected into every game page. It paces Ren’Py
  to the display refresh, loads the engine compressed from Cache Storage, keeps `~/.renpy` in
  memory and in sync with the server, restores compiled Python caches, and talks to the player UI
  (fullscreen, save & exit, resume).
- Ren’Py 7 games are not supported yet: their web engine is a different system. Ren’Py 8 games
  of any 8.x release run on the newest 8.x engine.

## Development

```bash
cd server && npm ci && npm test && npm run build
DATA_DIR=/tmp/rp/data GAMES_DIR=/tmp/rp/games PORT=3999 \
  RENPLAY_RUNTIME_PATH=$PWD/../runtime/renplay-runtime.js node dist/index.js
cd selector && npm ci && npm run dev   # proxies /api, /g, /engine to :3999
```

`make build` builds the image; `docker compose up --build` runs it with `./games` and `./data`.

## License

MIT
