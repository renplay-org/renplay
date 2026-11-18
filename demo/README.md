# The public demo

[demo.renplay.org](https://demo.renplay.org) lets anyone try Renplay without installing it. It is the static demo
below: the real library and game player as plain files, with each visitor's saves in their own browser.

The demo image described first (`RENPLAY_DEMO`) is still built and published with each release, as
`ghcr.io/renplay-org/renplay:demo`, for anyone who wants a demo with a server. The static demo is made from it.

## The demo image

### What a visitor gets

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

### How it resets

Everything is in the image: the installed game, its art, the catalog, the guest. Every start from the
image is a fresh demo with an empty disk. When visitors keep coming, the demo stops itself after 4
hours of running, once nobody has asked anything for a minute (health checks do not count), and at
4 hours and 15 minutes in any case, so it starts fresh again.

### How it is built

`.github/workflows/demo.yml` runs after each release, or by hand:

1. `build-games.sh <Ren'Py version> games/` downloads the official Ren'Py SDK, checks its sha256
   against renpy.org, takes the music out of The Question (`patch-the-question.py`) and builds it as
   a normal PC download.
2. `Dockerfile` starts from the release's image. Its first stage runs `seed.mjs`: Renplay with a
   throwaway admin installs the games with their recipes and makes their art. The admin's password
   is random and never kept, and a demo refuses every sign-in but the guest. The second stage copies
   `/data` and `/games` in and turns the demo on.
3. The image is pushed as `ghcr.io/renplay-org/renplay:demo`. It listens on port 8080, with the health check
   `/api/health`.

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
- A visitor can do what playing needs, and nothing else (see "What a visitor can do" below). The library leaves out the
  rest (`Me.demoStatic`), and the stand-in refuses it too, so a hand-made request gets the same answer as a button
  would.

### What a visitor can do

The rule: what playing needs, and nothing else. The demo shows Renplay and a game running, it does not manage a library.
Each line has its reason. The library hides the control, and the stand-in refuses the request with the demo's words
("The demo cannot do this. Install your own Renplay to try it."), from the list in `server/src/shared/demo-refusals.ts`.

Kept:

- **Playing The Question**, saving and loading in the game, and Resume. That is the demo.
- **The game's own saving.** The runtime's writes and deletes of its files, its compiled caches, play time and last
  played. Ren'Py writes and removes files itself (auto-saves, persistent data), and the runtime would fail without them.
- **Naming a save**, on the game page and in the game's menu. It is how a visitor sees a save is theirs, and it keeps one
  small text.
- **The game's own menu**: sound, full screen, text size, picture fit and the accessibility screen. They are the player's.
- **Browsing the Catalog**, read only. It is half of what Renplay is. Its sheet says "Install your own Renplay to add
  games." where the install button would be.
- **Play history and This browser.** Lighter background, Move cards with the pointer and Keep game cache are per-device
  display and storage switches, and Keep game cache protects the visitor's saves from the browser clearing them.

Hidden and refused:

- **Every download**: a save's download, Export all, the Account's export, the file browser, mods, the game's log, logs,
  backups and the game's files. A demo is not a place to take files out, and a visitor's save is no use outside it. The
  game's own page, `game.zip`, `/api/saves/<id>/raw` and `/boot` stay, since the game loads through them: they are plain
  files of a free game and the visitor's own saves in their own browser.
- **Deleting a save, Previous versions and Restore.** Playing does not need them, and the history is a safety net for a
  library that lives for years, not a demo that lives in a browser. A pin and a note go too (pinned saves keep every
  version, which only grows what the browser stores). A pin made before this limit stays as it was.
- **Import, Copy to another game, Sync codes and Export all.** They bring files in or out.
- **Settings beyond this browser** and the adult level. The demo has no adult games, and the level is the installation's.
- **Account**: name, picture, password, PIN, sign-ins, sessions and tokens. The guest is not an account.
- **People, Activity and every admin page**, and adding games: Add games, uploads, the catalog's install buttons, mods,
  walkthroughs, art. A visitor has no server to add to, and a game the demo does not hold cannot be played.
- **Favourites, ratings and status.** They did not make the demo feel alive: with one game to play they only gave
  something to click, and a rating of the one game says nothing. Resume is what shows progress.
- **Not now**, the update card, the game's developer console and its log. The first two manage a library, the others are
  for a developer.

What a hand-made request can still reach is what the page itself reads: the visitor's own saves (`raw`, `boot`) and the
catalog snapshot. Nothing it writes lasts beyond the visitor's own browser, and it can write only what is kept above.

### How it works

`static/sw/stand-in.ts` is a service worker, built to `/sw.js` (the name the library registers). The library and the game's own
frame are both controlled by it, so the game's save requests reach it too, and they share one origin, so they share one store.

- `answer.ts` answers `/api/`: the session, the guest, games, the catalog (read only), saves with their history (read
  only), names, play time. What it reads of the server's answers is a snapshot made at build time
  (`/demo/snapshot.json`). Its saves and progress live in a store (`idb.ts` in the browser, `memory-store.ts` in tests).
- A save's metadata and picture are read in the browser (`zip.ts`), within the server's limits for a save file
  (`server/src/util/zip.ts`): 2,048 entries, 64 MiB an entry and in all. The whole directory is checked first, and the bytes
  that come out are counted and stopped at what it declared. The limits of the guest's saves are the server demo's: 2 MB a
  file, and 32 MB and 1,000 files in all, with the earlier versions counted too (a pinned save keeps every version, so
  the total is its end), and 3 earlier versions of each unpinned save. Changes to the saves wait for one another.
- A change from another site is refused (`origin.ts`): a form on another site can send a navigation to `/api/` that
  this worker answers.
- Every other write is refused, and so is a save's download. The static demo allows a short list of writes (the game's
  own saving, a save's name, play time and the guest's sign-in), and what the server demo refuses is one list too:
  `server/src/shared/demo-refusals.ts`, which `accounts/access.ts` and the stand-in both read. A write that is not in
  the list is refused with the same words, so a route added to the server is refused here until someone allows it.
- A change tells every open page, through `postMessage`, and the page's loader turns it into
  `renplay:saves-changed`, which the embed bridge already hears. The website's messages (`ready`, `engaged`,
  `saved`, `nudge`, `refresh`) are the same as the server demo's.
- The built `index.html` has a small loader that registers the worker and starts the library when the stand-in of the
  same build says it is ready, since the first request is `/api/me`. A worker that controls the page is not enough: a
  visitor who has been to the server demo still has its worker, at the same `/sw.js`, until the new one takes over. WebKit sometimes leaves a page uncontrolled: the loader reloads up to 3 times. WebKit's
  `Blob.stream()` fails in a service worker, so `zip.ts` makes its own stream.
- The game's page, `game.zip`, the runtime and the streamed files of a build are plain files in `g/<id>/<build>/`. The
  engine is not copied: the page points at the engines host.

### How it is built

`node demo/static/build.mjs <out> --seed <dir> [--base <url>] [--embedder <origin>]`:

1. Builds the library and the worker. Drops the PDF reader's files, which the demo's games do not use.
2. `capture.mjs` signs in as the guest on a running demo server (`--base`) and reads its answers, the page of each game
   and the runtime. It reads only. Each catalog entry keeps only its grid picture, the one the Catalog page shows.
   The pictures the answers and the game pages name, in any format, are the only art copied (`api/art/`).
3. `snapshot.mjs` writes the files, and takes each game's build files from `--seed`, the demo image's seed stage:
   `docker buildx build --build-arg IMAGE=<the image the demo was built from> --target games --output type=local,dest=<dir> demo`
   (see `Dockerfile`). Every seed run installs with a new build name, so the export must be the build the demo image holds: the
   same image and context make Docker reuse that build.
4. `headers.mjs` writes `_headers`: `frame-ancestors` for the demo itself and the embedder only (the policy of the
   server demo), `X-Robots-Tag: noindex` on every answer, `index.html`, `sw.js` and `/demo/*` checked each time,
   hashed assets and art kept for good. `seo.mjs` gives `index.html` the title "Renplay demo", a description and a
   robots meta with noindex, and writes a `robots.txt` that lets crawlers in. They are let in on purpose: a page that
   robots.txt blocks is never fetched, so its noindex is never read, and the address can still be listed. The server
   demo's image (`Dockerfile`) does the same.
5. `art.mjs` reads the finished output and fails when its snapshot or a game's page names an `/api/art` file the output
   lacks. The stand-in leaves pictures to the host, so such a file would be a 404 for the visitor.
6. Checks the output against Cloudflare's static asset limits (20,000 files, 25 MiB a file) and fails if it does not fit.

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
  in the contract test. A route in `limited` is one the server demo lets its guest do and the static demo refuses on
  purpose.
- `demo-static-limits.test.ts` sends a hand-made request for each kind of thing a visitor may not do to the stand-in and
  checks the refusal and its words, that the demo server does accept the ones in `limited`, that every route of the
  server that is not answered is refused, and that what playing needs still works.
- `demo-static-headers.test.ts` checks the headers.
- `demo-static-art.test.ts` writes a snapshot from a demo server and checks that every picture its answers and pages name is
  in the output, that the catalog's other formats are dropped, and that the build's check fails on a missing one.
- `server/scripts/app-ui/specs/static-demo.spec.mjs` serves the output on `localhost` and, in a test embedder page with
  the laptop and phone frames, checks that a save made in one frame appears in the other, survives a reload and is not
  in a second browser; that every request goes to the static server or the engines host and none fail; and that only
  the embedder can frame the demo. It runs in Chromium and in WebKit at desktop size, and at 390 px, where the game
  cannot be driven by taps, the save is made with the runtime's own save request. It also checks that the hidden controls
  are absent (Not now, favourite, status, rating, a save's Download, Delete, Pin, History and Import, the Account's adult
  games, the install button) and that a hand-made request for each kind is refused and changes nothing. In `mise run test:ui` the
  demo is built from a demo server with a small stand-in for the engine. `demo.yml` runs it on the real output with
  `STATIC_DEMO_DIR`, where the real game is played and saved with Q.Save.

### Publishing

`static/wrangler.jsonc` is a Worker with static assets for `demo.renplay.org`, with the single page app fallback
(an address that is not a file is the library's page). `demo.yml` builds the output from the demo image, tries it
in browsers, and deploys it when the repository variable `STATIC_DEMO_DEPLOY` is `true`. It
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
