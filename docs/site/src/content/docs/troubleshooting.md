---
title: Troubleshooting
description: Fixes for games that will not start, slow menus, downloads that stop and more.
---

First look at the logs: **Activity** shows every install job with its log, and `docker logs
renplay` shows the server. When you report a problem, attach the job log.

## An install fails

- Read the job log in **Activity**. A failed install keeps its download, so you can retry.
- **Not enough space.** Installs need room in `/games` for the build, and `/games/_renplay/work`
  for scratch space, on the same filesystem.
- **Permission denied.** The container runs as user 1000. Give that user write access to both
  folders.
- **The engine cannot be downloaded.** The first install fetches the Ren’Py web engine from
  `RENPLAY_ENGINES_URL`. Check that the server can reach `engines.renplay.org`. Older Renplay
  versions use addresses that no longer exist: [upgrade](/upgrading/).
- **“Cannot be installed.”** The reason is shown in Add games. Engines that need a desktop
  (RPG Maker XP, Wolf RPG and other programs made for one system) cannot run in a browser. See [Engines](/engines/).

## A game will not start

1. Reload the page and try again. The first start of a big game downloads `game.zip` and can take
   a while. The loading screen shows how far it is.
2. Open the game’s page in another browser. If it works there, clear site data for Renplay in the
   first one.
3. Look at the game’s log for a Python error: the player menu’s **Options** has **Download the game’s log**.
4. Check the [catalog](/catalog/): the recipe may say the game needs a different engine version or a
   patch. [Report it](/catalog/#request-a-game) if the catalog says nothing.
5. Try pinning another engine with `RENPLAY_ENGINE` (see [Configuration](/configuration/)) and
   reinstalling.

### A Ren’Py 7 game stops with a Python error

Games made with Ren’Py 7 or older run on the Ren’Py 8 engine, which uses Python 3. Renplay runs
their Python 2 code the way Python 2 did: whole-number division, lists from `keys()` and `map()`,
sorting numbers together with text, `cmp`, `long`, `iteritems`, Python 2 classes and statements,
and the game's own `.py` files. A game installed with an earlier Renplay needs **Reinstall** to get it. What
can still fail is rarer: text and bytes mixed up (`"text".encode()` used as text), or libraries
written in C. Tell the catalog which game and which error.

### A game is slow to start the first time

Games made with an older Ren’Py compile their scripts again on every start in the new engine (it
took 17 seconds for one game). Renplay stores the compiled scripts with the build, so only the
first start is slow.

## Menus are slow or choppy

If a menu is slow while the page is otherwise idle, the browser’s graphics process is the
bottleneck, not the images. Renplay already works around the worst case. Try:

- Turn on hardware acceleration in the browser, and update it.
- Close other tabs that use the graphics card.

If it is still slow, report the game, browser and device in
[Discussions](https://renplay.org/discussions).

## Downloads stop with a network error (HTTP/3)

Some gateways drop long downloads on HTTP/3 (`ERR_QUIC_PROTOCOL_ERROR` in the browser console). The
player resumes `game.zip` by itself with Range requests, and shows an error with a retry button
after 8 failures. If it keeps happening, turn HTTP/3 off on your proxy or gateway for Renplay.

## iPhone: no fullscreen

Safari on iPhone cannot show any web page full screen. Add Renplay to the Home Screen and open it
from there. See [Playing](/guides/playing/#iphone-and-ipad-add-it-to-the-home-screen).

## A game will not play offline

- **Keep offline** needs Renplay over HTTPS (or `localhost`): browsers keep nothing for a plain
  `http://` address. See [Reverse proxy and HTTPS](/install/reverse-proxy/).
- **"This browser has room for less than the game needs."** The browser gives each site a share of the disk. Free
  space on the device, or remove another game's offline copy.
- **iPhone and iPad** keep games only for Renplay on the Home Screen. A Safari tab loses them after a
  week without a visit.
- **"Open this game once with a network"** means the person signed in on this browser has not opened
  the game online here yet. A kept copy plays for each person only after they opened it once.
- A game that got a new version keeps playing its old copy until **Update offline copy**.

## Network storage is slow

Creating a file on network storage costs a round trip, often 100 to 250 ms on NFS. Renplay keeps
streamed assets in one pack per game for that reason, so installs are sequential writes. Still:

- Keep `/data` on a local disk if you can. The library is a SQLite database, and it dislikes
  network file systems.
- Keep `RENPLAY_DIR` on the same filesystem as `/games`.
- Deleting a game runs in the background so it does not stall the server.

## The proxy changes things

Gateways that strip `Accept-Encoding` or decode gzip break compressed files. Renplay serves the
engine as pre-compressed files for that reason. If a game loads halfway and stops, check that the
proxy passes `Range` requests and does not rewrite bodies. See
[Reverse proxy and HTTPS](/install/reverse-proxy/).

## Reading the server log

Every line has the same columns: the date and time (the server's `TZ`), the level, where it comes
from, and what happened.

```text
2026-11-07 12:10:31  info   [server]   Renplay 4.0.1
2026-11-07 12:10:31  info   [server]   Sign-in: off, everyone plays as the owner
2026-11-07 12:10:34  info   [catalog]  Updated: 23 recipes
2026-11-07 12:12:05  info   [job]      Install of eternum started
2026-11-07 12:15:17  info   [job]      Install of eternum finished in 3 m 12 s
2026-11-07 12:16:40  warn   [http]     GET /api/games/missing 404 in 5 ms, 26 B, from 203.0.113.7
2026-11-07 12:16:41  info   [http]     PUT /api/games/eternum/rating 200 in 9 ms, 85 B, from 203.0.113.7
```

The start lists the version, the library, sign-in, the adult games level, the catalog, save backups
and the folders. After that come installs, catalog updates, backups, sign-ins, warnings and errors,
and requests: one line each, with the address of the person who sent it as the proxy in front saw
it. Games, pictures, health checks and the play time heartbeat are never logged.

`RENPLAY_LOG_LEVEL` chooses how much:

| Level | Shows |
|---|---|
| `error` | Errors only |
| `warn` | Also warnings and requests that failed (4xx, 5xx) |
| `info` | Also the start, installs, catalog updates, backups, sign-ins, and requests that change something. The default |
| `debug` | Also every request, and each install's own log as it runs |

## Nothing helps

Ask in [Discussions](https://renplay.org/discussions), or open a
[bug report](https://github.com/renplay-org/renplay/issues/new?template=bug_report.yml) with the
job log.
