# The public demo

[demo.renplay.org](https://demo.renplay.org) lets anyone try Renplay without installing it. It runs
on Render's free plan, never on a maintainer's own servers.

## What a visitor gets

- **Try the demo** signs them in as a shared guest (`RENPLAY_DEMO=on`). There is no account to make.
- One game to play: **The Question**, Ren'Py's own sample game, without its music. Its art (MIT,
  like Ren'Py) is in the demo's own recipe, `recipes/the-question.yaml`. The Ren'Py Tutorial
  cannot be distributed outside Ren'Py, and other free games need their developers' permission.
- The whole catalog, with adult games blurred. Nothing can be installed.
- The guest can play, save, rate, mark a status and keep a game offline. They cannot upload,
  install, change the account or open Settings. Saves come only from playing: no imports, copies or
  Sync codes. A save file is at most 2 MB, all saves with their history at most 32 MB and 1,000
  files (each keeps 3 earlier versions), so nobody can fill the demo's disk or memory.
- Everyone is the same guest: a rating, a status, a save one visitor makes, every other visitor sees
  until the next fresh start. Tags and the level for adult games cannot be changed.
- A banner on every page says it is a demo and links to the install guide.

## How it resets

Everything is in the image: the installed game, its art, the catalog, the guest. Render's free plan
starts a service again from its image after 15 minutes without visitors, with an empty disk. When
visitors keep coming, the demo stops itself after 4 hours of running, once nobody has asked anything
for a minute (health checks do not count), and at 4 hours and 15 minutes in any case. Render starts
it fresh.

## How it is built

`.github/workflows/demo.yml` runs after each release, or by hand:

1. `build-games.sh <Ren'Py version> games/` downloads the official Ren'Py SDK, checks its sha256
   against renpy.org, takes the music out of The Question (`patch-the-question.py`) and builds it as
   a normal PC download.
2. `Dockerfile` starts from the release's image. Its first stage runs `seed.mjs`: Renplay with a
   throwaway admin installs the games with their recipes and makes their art. The admin's password
   is random and never kept, and a demo refuses every sign-in but the guest. The second stage copies
   `/data` and `/games` in and turns the demo on.
3. The image is pushed as `ghcr.io/renplay-org/renplay:demo`, and the `RENDER_DEPLOY_HOOK` secret
   tells Render to start the demo from it.

`make-art.mjs` made The Question's art from the game's own pictures. Run it again to change them.

To try it locally:

```sh
sh deploy/demo/build-games.sh 8.5.3 deploy/demo/games
docker build -f deploy/demo/Dockerfile --build-arg IMAGE=ghcr.io/renplay-org/renplay:<version> -t renplay-demo deploy/demo
docker run --rm -p 8080:8080 --memory 512m --cpus 0.1 renplay-demo
```

## Render

Once, by a maintainer:

1. A free Render account and workspace, without a payment method: Render then suspends the demo for
   the rest of a month rather than charge for it.
2. **New → Web Service → Existing image**: `ghcr.io/renplay-org/renplay:demo`, instance type
   **Free**. Environment variable `PORT=8080` (Render sends visitors to that port). Health check path
   `/api/health`.
3. **Settings → Custom domains**: `demo.renplay.org`. In the renplay-org Cloudflare DNS, a CNAME
   `demo` to the service's `onrender.com` address, DNS only (Render makes the certificate).
4. **Settings → Deploy hook**: copy the URL into the renplay-org/renplay secret `RENDER_DEPLOY_HOOK`.
5. Once it runs, check the log: requests should come **from** visitors' addresses, not one Render
   address. If they do not, change `RENPLAY_TRUSTED_HOPS` in the Dockerfile.

The free plan gives 512 MB and 0.1 CPU, enough for serving a small game: the demo uses about 75 MB
and starts in about half a minute. A cold start takes about a minute in all, with Render's own
loading page meanwhile.
