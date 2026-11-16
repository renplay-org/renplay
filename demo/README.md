# The public demo

[demo.renplay.org](https://demo.renplay.org) lets anyone try Renplay without installing it.

## What a visitor gets

- **Try the demo** signs them in as a guest of their own (`RENPLAY_DEMO=on`). There is no account to make.
- One game to play: **The Question**, Ren'Py's own sample game, without its music. Its art (MIT,
  like Ren'Py) is in the demo's own recipe, `recipes/the-question.yaml`. The Ren'Py Tutorial
  cannot be distributed outside Ren'Py, and other free games need their developers' permission.
- The catalog's safe-for-work games. Adult games are turned off, and the banner says so. Nothing can be installed.
- The guest can play, save, rate, mark a status and keep a game offline. They cannot upload,
  install, change the account or open Settings. Saves come only from playing: no imports, copies or
  Sync codes. A save file is at most 2 MB, all saves with their history at most 32 MB and 1,000
  files (each keeps 3 earlier versions), so nobody can fill the demo's disk or memory.
- Every visitor has their own guest, with their own saves, progress, favourites, ratings and choices. Nobody
  sees what another visitor did. A guest can change its own tags and its level for adult games, never above
  Blurred.
- A banner on every page says it is a demo and links to the install guide, except in the website's embed mode.

## Guests

A guest is a player with no password, made when a visitor opens the demo. It is found again by the visitor's
session, or by a visitor key when the website's frames bring one (see Embed the demo). Nothing of a guest's
survives its removal: its saves, progress, choices and sessions go. A guest is removed when:

- Nobody has seen it for 2 hours, checked every minute.
- The demo holds 100 guests and a new visitor arrives. The one unseen the longest goes first, but only a guest
  unseen for more than 10 minutes. When every guest has been seen in the last 10 minutes, nobody is removed and the
  newcomer is refused with "The demo is full right now. Try again in a few minutes." (HTTP 503), in both frames
  and on the sign-in page. A refusal does not count against the address's new guests.
- The demo restarts (every 4 hours, below).

Making guests is limited: 20 new guests an hour from one address, and 120 sign-ins a minute. A guest keeps its 20
newest sessions, and no record of its browser (Who is playing needs PINs, which a guest does not have), so a frame
that has no cookies and signs in again at every load adds only a session, which the 20 bound. The limits are in `demoGuests` in `server/src/config.ts`. The save limits per guest are
unchanged: 2 MB a file, 32 MB and 1,000 files in all. At 100 guests that bounds the saves at about 3 GB in the
worst case. A real visitor's saves are a few hundred KB. Memory is small: a few database rows, one save-store
object and a cached session for each guest who has been active.

The guest is a player. The demo still refuses what it always did for a guest: installs, uploads, art uploads, save
imports, copies, Sync codes, a new save folder, a password, a PIN, tokens, sessions, linked sign-ins and a change
of the guest's name or picture. Nothing of it is admin.

## Where it runs

The image is meant for one place, behind an HTTPS edge that sits in front of its own nginx: Render, with its
Cloudflare edge, for demo.renplay.org. It assumes two things about that edge, and a run anywhere else must change
them.

**The trusted edge.** The image trusts `CF-Connecting-IP` from any connecting address (`set_real_ip_from 0.0.0.0/0`
in `Dockerfile`), and Renplay trusts nginx alone (`RENPLAY_TRUSTED_HOPS=1`), so the limits on new guests count each
visitor by that header. This is safe only where nothing can reach the container except through an edge that
overwrites the header, as Render's Cloudflare edge does. Anyone who can reach the container directly can send any
`CF-Connecting-IP` they like, and so dodge the limit on new guests and push other guests out. Running the image
anywhere else, change the `sed` in `Dockerfile` before building. Behind a proxy of your own, narrow
`set_real_ip_from` to that proxy's addresses and set `real_ip_header` to the header it overwrites. On a published
port with nothing in front, remove the `real_ip_header` and `set_real_ip_from` lines, so every visitor is counted by
the address nginx sees.

**The public address.** nginx passes its own scheme to Renplay, which is `http` behind a TLS edge, so Renplay cannot
see that the page was served over HTTPS. The image sets `RENPLAY_PUBLIC_URL=https://demo.renplay.org` instead. That
makes every cookie `Secure`, gives a frame of another site its partitioned session (below), and names the origin a
request may come from. A browser that reaches the demo over plain HTTP may then drop the cookies, so a run
on plain HTTP, such as on localhost, sets it empty or to the address it uses:

```sh
docker run --rm -p 8080:8080 -e RENPLAY_PUBLIC_URL= renplay-demo
docker run --rm -p 8080:8080 -e RENPLAY_PUBLIC_URL=http://localhost:8080 renplay-demo
```

Behind another host's HTTPS edge, set it to the address people open the demo at.

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
docker run --rm -p 8080:8080 -e RENPLAY_PUBLIC_URL= renplay-demo
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

Both modes sign in a guest automatically (the visitor's own, see Visitor key below), hide the demo banner and account menu, and keep
`embed` while navigating. The embedder chooses the viewport: give the phone frame a real 390 by 844
CSS-pixel size and scale it visually with a CSS transform if needed. `phone` does not override the
app's responsive layout. On a touch device, Play and loading a save open the demo in the top window.
Do not sandbox the outer app frames. The game's own sandbox and message checks are unchanged.

A fresh guest has no Up next stage in the library. To show Play on the first view, open that frame
on `/game/the-question?embed=laptop` instead. A nudge only animates a Play or Resume button already
shown in that frame. It does not add a stage to the library.

### Visitor key

Give both frames one key, so they are one guest, and a visitor's save made in one shows in the other. Without
a key, each browser is its own guest through its session cookie, which is enough when the website and the demo
share a site (`renplay.org` and `demo.renplay.org`), because both frames then share the browser's cookies. The
key also works where they do not: a browser that blocks third-party cookies, or a website on another site.

1. The website makes the key once for its visitor, from 32 random bytes written as base64url (43 characters of
   `A-Z a-z 0-9 - _`), and keeps it in its own `localStorage`. The demo checks only that a key is 43 to 128 of those
   characters. It cannot tell how the key was made, so a key that is not random, or is shared, is as open as a
   guessable password. Shorter keys are refused.
2. It puts the key in the address fragment of both frames, never in the query:
   `https://demo.renplay.org/?embed=laptop#visitor=KEY`. A fragment is not sent to the server, not logged and
   not passed in a Referer header.
3. Each frame reads the key, keeps it for that tab (`sessionStorage`), takes it out of its address and signs in
   with it (`POST /api/auth/demo` with `{ "visitor": "KEY" }`). The server keeps only a hash of the key. The key
   names a demo guest and nothing else: it is not a session, a token or a password, and outside a demo it does
   nothing.
4. A guest made for a key is found again by the same key, from any browser or address, until the guest goes.

A key is a capability for one throwaway guest: whoever holds it can sign in as that guest and read and change its
saves and choices, and nothing else, since a guest has no more rights than any other. Do not share a link that
contains a visitor key, and do not log or send one anywhere but to the demo. The demo's own claim that nobody sees
what another visitor did holds for visitors who keep their key to themselves.

The session cookie, `renplay_session`, stays `HttpOnly` and `SameSite=Lax`. Over HTTPS (`RENPLAY_PUBLIC_URL`, above),
a frame that signed in with a key gets a second cookie, `renplay_session_framed`, with `SameSite=None; Secure;
Partitioned`, so Chrome and Firefox keep it for that frame even when they block third-party cookies. Its name is
its own because a browser sends the plain and the partitioned form together when both exist (a visitor who opened
the demo directly, then the website on the same site), and with one name the older one, the direct visit's, was read
first and the frames were the wrong guest. The server reads `renplay_session_framed` first and falls back to
`renplay_session` when that session is gone. A visitor who opened the demo directly and then the website on the
same site is therefore the key's guest from then on, in the frames and in the direct page, because the partitioned
cookie belongs to the site. Another site's frames never share the direct visit's guest. Both cookies are cleared
at sign-out. If you cache requests in front of Renplay by the session, include both cookies in the key, as the
image's nginx does.

Tested in real browsers over HTTPS with a self-signed certificate (`server/scripts/app-ui/specs/demo-https.spec.mjs`):
Chromium with third-party cookies blocked, and Firefox, for a website on the demo's site and on another site.
Safari does not store a cookie for a frame of another site: there the website and the demo must share a site, as
renplay.org and demo.renplay.org do (untested here). Firefox's stricter setting to block all third-party cookies
refuses the partitioned cookie as well. With no cookie at all a frame still finds its guest again from the key when
it reloads, but cannot stay signed in between requests, and shows "Could not open the demo".

A play link that leaves the frame (on a touch screen, Play opens the demo in the top window) carries the key in
its fragment, so the top window is the same guest. Links inside the demo carry no key.

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
  -e RENPLAY_PUBLIC_URL= -e RENPLAY_DEMO_EMBEDDER=http://127.0.0.1:5190 renplay-demo-embed
```

In another terminal, serve the website prototype from its own folder:

```sh
python3 -m http.server 5190 --bind 127.0.0.1 --directory /path/to/website-prototype
```

Open `http://127.0.0.1:5190`. Use `http://127.0.0.1:8080/?embed=laptop` and
`http://127.0.0.1:8080/game/the-question?embed=phone` as the frame addresses, and
`http://127.0.0.1:8080` as the demo message origin. The demo image already turns on `RENPLAY_DEMO`
and turns off adult games. It resets on restart. No deployment needs to change for the prototype.
