# Renplay

**Renplay is a self-hosted player for Ren’Py games in the browser, with saves on your own server.**

Add a game’s normal PC download, press Install and play it in any browser, on your computer, your tablet or your
phone. Every save goes to your own server the moment the game makes it, so you can stop on the laptop and carry on
from the phone. Ren’Py games play first. HTML games, such as Twine stories, play too, with fewer features.

Games come from their developers. Renplay and its catalog never host game files.

## Run it

Renplay is one container. Give it a folder for games and one for your saves:

```sh
docker run -d --name renplay --restart unless-stopped -p 8080:8080 \
  -v /path/to/games:/games \
  -v /path/to/data:/data \
  renplay/renplay:latest
```

Open http://localhost:8080. On a new install, enter the setup code from `docker logs renplay` and create the owner
account. Copy a game’s PC download into `/path/to/games/_archives/`, or upload it under **Add games**, and press
**Install**. Then press **Play**.

With Docker Compose:

```yaml
services:
  renplay:
    image: renplay/renplay:latest
    ports: ["8080:8080"]
    volumes:
      - ./games:/games   # games and their downloads
      - ./data:/data     # saves: back this up
    restart: unless-stopped
```

## Folders, port and user

| | |
|---|---|
| `/data` | Saves and their history, accounts, the library and mods. **Back this up**, and keep it on local disk, never on a network share. |
| `/games` | Installed games, engines and the `_archives` folder for downloads. It can be a network share. Allow about twice a game’s download size free while it installs. |
| `/downloads` | Optional. Mount a downloads folder here to keep it apart from installed games. |
| Port `8080` | The web interface, with a health check at `/api/health`. |
| User `1000:1000` | Both folders must be writable by this user. Use `--user 568:568` for another one, or start as root with `--user 0:0 -e PUID=99 -e PGID=100` and the image drops root before it starts. |

A read-only root filesystem works with writable `/data`, `/games` and a `/tmp` tmpfs.

## Tags

- `X.Y.Z`: one release. Pin one for a library you care about, so an upgrade happens when you
  decide. The newest version is on the [releases page](https://github.com/renplay-org/renplay/releases/latest).
- `latest`: the newest release.

Images are built for `amd64` and `arm64`, and are the same as `ghcr.io/renplay-org/renplay`.

## Use HTTPS outside your home network

New installs ask for sign-in. Put Renplay behind a reverse proxy with HTTPS before you share it, and set
`RENPLAY_PUBLIC_URL` to its public address. The docs show examples for Caddy and nginx.

## More

- [Try the demo](https://demo.renplay.org), with one game and the whole catalog
- [Docs](https://docs.renplay.org): [Docker Compose](https://docs.renplay.org/install/docker/),
  [Kubernetes](https://docs.renplay.org/install/kubernetes/), [configuration](https://docs.renplay.org/configuration/),
  [upgrading](https://docs.renplay.org/upgrading/) and [troubleshooting](https://docs.renplay.org/troubleshooting/)
- [Catalog](https://renplay.org/catalog): games tested in Renplay
- [Source on GitHub](https://github.com/renplay-org/renplay) and [release notes](https://renplay.org/releases)
- [Support](https://renplay.org/support)

Free and open source under the MIT license. Ren’Py is © Tom Rothamel and contributors, and Renplay is not
affiliated with it. Games belong to their developers.
