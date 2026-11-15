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
