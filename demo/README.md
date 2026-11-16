# The public demo

[demo.renplay.org](https://demo.renplay.org) lets anyone try Renplay without installing it.

## What a visitor gets

- **Try the demo** signs them in as a shared guest (`RENPLAY_DEMO=on`). There is no account to make.
- One game to play: **The Question**, Ren'Py's own sample game, without its music. Its art (MIT,
  like Ren'Py) is in the demo's own recipe, `recipes/the-question.yaml`. The Ren'Py Tutorial
  cannot be distributed outside Ren'Py, and other free games need their developers' permission.
- The catalog's safe-for-work games. Adult games are turned off, and the banner says so. Nothing can be installed.
- The guest can play, save, rate, mark a status and keep a game offline. They cannot upload,
  install, change the account or open Settings. Saves come only from playing: no imports, copies or
  Sync codes. A save file is at most 2 MB, all saves with their history at most 32 MB and 1,000
  files (each keeps 3 earlier versions), so nobody can fill the demo's disk or memory.
- Everyone is the same guest: a rating, a status, a save one visitor makes, every other visitor sees
  until the next fresh start. Tags and the level for adult games cannot be changed.
- A banner on every page says it is a demo and links to the install guide, except in the website's embed mode.

## How it resets

Everything is in the image: the installed game, its art, the catalog, the guest. Every start from the
image is a fresh demo with an empty disk. When visitors keep coming, the demo stops itself after 4
hours of running, once nobody has asked anything for a minute (health checks do not count), and at
4 hours and 15 minutes in any case, so it starts fresh again.

## How it is built

`.github/workflows/demo.yml` runs after each release, or by hand:

1. `build-games.sh <Ren'Py version> games/` downloads the official Ren'Py SDK, checks its sha256
   against renpy.org, takes the music out of The Question (`patch-the-question.py`) and builds it as
   a normal PC download.
2. `Dockerfile` starts from the release's image. Its first stage runs `seed.mjs`: Renplay with a
   throwaway admin installs the games with their recipes and makes their art. The admin's password
   is random and never kept, and a demo refuses every sign-in but the guest. The second stage copies
   `/data` and `/games` in and turns the demo on.
3. The image is pushed as `ghcr.io/renplay-org/renplay:demo`, and the `DEMO_DEPLOY_HOOK` secret
   starts the demo from it. The image listens on port 8080, with the health check `/api/health`.

`make-art.mjs` made The Question's art from the game's own pictures. Run it again to change them.

To try a released demo locally:

```sh
sh demo/build-games.sh 8.5.3 demo/games
docker build --build-arg IMAGE=ghcr.io/renplay-org/renplay:<version> -t renplay-demo demo
docker run --rm -p 8080:8080 renplay-demo
```

## The static demo

The same demo as plain files, with no server behind it. It is built in `static/` and meant for a static host
(Cloudflare, as a Worker with static assets). A visitor gets one copy of the demo in their own browser:

- Their saves, save history, names, pins, ratings, statuses and play time stay in that browser (IndexedDB) until they
  clear the site's data. Nobody else sees them, and nothing resets. They are not on other devices.
- It needs a secure context: https, or `localhost` for trying it. A page that frames the demo must be secure too,
  and the browser must allow service workers and storage for the site.
- The banner says "This is a demo. Your saves stay in this browser." with the link to install your own.
- The library leaves out what needs a server: Keep offline, exporting and importing saves, copying a save to
  another game and choosing other art (`Me.demoStatic`).

### How it works

`static/sw/stand-in.ts` is a service worker, built to `/sw.js` (the name the library registers). The library and the game's own
frame are both controlled by it, so the game's save requests reach it too, and they share one origin, so they share one store.

- `answer.ts` answers `/api/`: the session, the guest, games, the catalog (read only), saves with history, names and
  pins, progress, play time. What it reads of the server's answers is a snapshot made at build time
  (`/demo/snapshot.json`). Its saves and progress live in a store (`idb.ts` in the browser, `memory-store.ts` in tests).
- A save's metadata and picture are read in the browser (`zip.ts`). The limits are the server demo's: 2 MB a file,
  32 MB in all, 1,000 files and 3 earlier versions of each.
- Every other route is refused the way the server demo refuses it. What the server demo refuses is one list,
  `server/src/shared/demo-refusals.ts`, which `accounts/access.ts` and the stand-in both read.
- A change tells every open page, through `postMessage`, and the page's loader turns it into
  `renplay:saves-changed`, which the embed bridge already hears. The website's messages (`ready`, `engaged`,
  `saved`, `nudge`, `refresh`) are the same as the server demo's.
- The built `index.html` has a small loader that registers the worker and waits for it to control the page, since the
  first request is `/api/me`. WebKit sometimes leaves a page uncontrolled: the loader reloads up to 3 times. WebKit's
  `Blob.stream()` fails in a service worker, so `zip.ts` makes its own stream.
- The game's page, `game.zip`, the runtime and the streamed files of a build are plain files in `g/<id>/<build>/`. The
  engine is not copied: the page points at the engines host.

### How it is built

`node demo/static/build.mjs <out> --seed <dir> [--base <url>] [--embedder <origin>]`:

1. Builds the library and the worker. Drops the PDF reader's files, which the demo's games do not use.
2. `capture.mjs` signs in as the guest on a running demo server (`--base`) and reads its answers, the page of each game
   and the runtime. It reads only. Each catalog entry keeps only its grid picture, the one the Catalog page shows.
   The pictures the answers name are the only art copied (`api/art/`).
3. `snapshot.mjs` writes the files, and takes each game's build files from `--seed`, the demo image's seed stage:
   `docker buildx build --build-arg IMAGE=<the image the demo was built from> --target games --output type=local,dest=<dir> demo`
   (see `Dockerfile`). Every seed run installs with a new build name, so the export must be the build the demo image holds: the
   same image and context make Docker reuse that build.
4. `headers.mjs` writes `_headers`: `frame-ancestors` for the demo itself and the embedder only (the policy of the
   server demo), `index.html`, `sw.js` and `/demo/*` checked each time, hashed assets and art kept for good.
5. Checks the output against Cloudflare's static asset limits (20,000 files, 25 MiB a file) and fails if it does not fit.

`--embedder` is the one origin the embed bridge talks to and ignores messages from anything else. It is set at build
time, `https://renplay.org` by default.

To try it, with the demo image running as in "To try a released demo locally" above:

```sh
docker buildx build --build-arg IMAGE=ghcr.io/renplay-org/renplay:<version> --target games --output type=local,dest=/tmp/demo-seed demo
node demo/static/build.mjs /tmp/static-demo --seed /tmp/demo-seed --base http://127.0.0.1:8080 --embedder http://localhost:5190
node server/scripts/app-ui/static-demo-server.mjs /tmp/static-demo 5191    # http://localhost:5191
```

### Tests

- `server/src/__tests__/demo-static-contract.test.ts` runs the stand-in's `answer()` and a real server in demo mode on
  the same requests and compares the status and the JSON's shapes. The server has the demo's own recipe and art for The
  Question and two more catalog games (the seed itself needs a built game and the network). A failing case names the
  key that differs. The stand-in differs from the server in two places, both said in the test: the upload of compiled caches
  is taken (the server refuses the guest) and `Me` says `demoStatic`.
- `demo-static-routes.test.ts` lists every route the server registers and what the static demo does about it
  (`demo-static-routes.ts`). A new server route fails it until it is classified, and a route that is answered needs a case
  in the contract test.
- `demo-static-headers.test.ts` checks the headers.
- `server/scripts/app-ui/specs/static-demo.spec.mjs` serves the output on `localhost` and, in a test embedder page with
  the laptop and phone frames, checks that a save made in one frame appears in the other, survives a reload and is not
  in a second browser; that every request goes to the static server or the engines host and none fail; and that only
  the embedder can frame the demo. It runs in Chromium and in WebKit at desktop size, and at 390 px, where the game
  cannot be driven by taps, the save is made with the runtime's own save request. In `mise run test:ui` the
  demo is built from a demo server with a small stand-in for the engine. `demo.yml` runs it on the real output with
  `STATIC_DEMO_DIR`, where the real game is played and saved with Q.Save.

### Publishing

`static/wrangler.jsonc` is a Worker with static assets for `demo.renplay.org`, with the single page app fallback
(an address that is not a file is the library's page). `demo.yml` builds the output after the server demo is
published, tries it in browsers, and deploys it only when the repository variable `STATIC_DEMO_DEPLOY` is `true`. It
uses the same `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets as `sites.yml`.

## Embed the demo

Only a server with `RENPLAY_DEMO=on` enables this mode. Normal installations keep their existing
headers and player framing rules. The library normally allows dashboard frames. The demo restricts
both the library and game pages to itself and one website origin, `https://renplay.org` by default.
Set `RENPLAY_DEMO_EMBEDDER` to a different exact HTTP or HTTPS origin for a local prototype. Do not
include a path, trailing slash, wildcard or list of origins.

```html
<iframe title="Renplay on a laptop" src="https://demo.renplay.org/?embed=laptop"
  width="880" height="700" allow="fullscreen"></iframe>
<iframe title="Renplay on a phone" src="https://demo.renplay.org/game/the-question?embed=phone"
  width="390" height="844" allow="fullscreen"></iframe>
```

Both modes sign in the shared guest automatically, hide the demo banner and account menu, and keep
`embed` while navigating. The embedder chooses the viewport: give the phone frame a real 390 by 844
CSS-pixel size and scale it visually with a CSS transform if needed. `phone` does not override the
app's responsive layout. On a touch device, Play and loading a save open the demo in the top window.
Do not sandbox the outer app frames. The game's own sandbox and message checks are unchanged.

A fresh guest has no Up next stage in the library. To show Play on the first view, open that frame
on `/game/the-question?embed=laptop` instead. A nudge only animates a Play or Resume button already
shown in that frame. It does not add a stage to the library.

### Messages

Messages are objects with a `type` property. The demo sends only to the configured embedder origin.
The embedder must check both `event.origin` and `event.source` against its expected demo frame.
The demo accepts commands only from its parent window at the configured origin.

| Direction | Type | Meaning |
| --- | --- | --- |
| Demo to website | `renplay-embed:ready` | The app and library data have loaded. Once per app load, not each page change. |
| Demo to website | `renplay-embed:engaged` | The first real pointer or keyboard interaction. Once per app load. |
| Demo to website | `renplay-embed:saved` | The person's saves changed. Includes `gameId`, `label` and `time` (Unix milliseconds). If no save remains, `label` and `time` are `null`. |
| Website to demo | `renplay-embed:nudge` | Make the first visible Play or Resume button breathe once. No animation with reduced motion. |
| Website to demo | `renplay-embed:refresh` | Refetch saves and progress, including Up next. |

When one frame reports `saved`, send `refresh` to the other frame. This uses the real server's saves,
not browser-local copies. The session cookie stays HTTP-only with `SameSite=Lax`. The production
website and demo are same-site. For local work, use the same hostname for both origins, such as
`127.0.0.1` with different ports. Mixing `localhost` and `127.0.0.1` is not same-site.

The static demo is embedded the same way, with the same addresses and messages. The embedder's origin is fixed when it is
built (`--embedder`), and the bridge ignores messages from any other origin. The saves are the visitor's, in the browser's
storage for the demo's site, not on a server. The relay below works as it does with the server demo, and no session
cookie is involved. Outside the website's frames, another open tab of the demo shows a change when it is reloaded or
focused.

```js
const demoOrigin = 'https://demo.renplay.org'
const laptop = document.querySelector('iframe[title="Renplay on a laptop"]')
const phone = document.querySelector('iframe[title="Renplay on a phone"]')
window.addEventListener('message', (event) => {
  if (event.origin !== demoOrigin) return
  if (event.source !== laptop.contentWindow && event.source !== phone.contentWindow) return
  if (event.data?.type === 'renplay-embed:saved') {
    const other = event.source === laptop.contentWindow ? phone : laptop
    other.contentWindow.postMessage({ type: 'renplay-embed:refresh' }, demoOrigin)
  }
})
```

### Run this branch for a website prototype

Build the app image from this checkout, then seed a demo from it. The game download and first build
need network access and Docker. The app image contains this branch's embed support, not a release's.

```sh
mise install
mise run image
sh demo/build-games.sh 8.5.3 demo/games
docker build --build-arg IMAGE=renplay:dev -t renplay-demo-embed demo
docker run --rm --name renplay-demo-embed -p 8080:8080 \
  -e RENPLAY_DEMO_EMBEDDER=http://127.0.0.1:5190 renplay-demo-embed
```

In another terminal, serve the website prototype from its own folder:

```sh
python3 -m http.server 5190 --bind 127.0.0.1 --directory /path/to/website-prototype
```

Open `http://127.0.0.1:5190`. Use `http://127.0.0.1:8080/?embed=laptop` and
`http://127.0.0.1:8080/game/the-question?embed=phone` as the frame addresses, and
`http://127.0.0.1:8080` as the demo message origin. The demo image already turns on `RENPLAY_DEMO`
and turns off adult games. It resets on restart. No deployment needs to change for the prototype.
