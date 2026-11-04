---
title: Docker and Docker Compose
description: Run Renplay with Docker or Docker Compose.
---

## Docker Compose

Create a folder for Renplay, and in it a `compose.yaml`:

```yaml
services:
  renplay:
    image: ghcr.io/renplay-org/renplay:__RENPLAY_VERSION__
    container_name: renplay
    restart: unless-stopped
    ports:
      - "8080:8080"
    volumes:
      - ./games:/games
      - ./data:/data
```

Then:

```sh
mkdir -p games data
sudo chown 1000:1000 games data
docker compose up -d
```

Open `http://<your server>:8080`.

- The image runs as user and group **1000**. If you pick other folders, they must be writable by
  that user, or set `user:` in the Compose file to one that owns them.
- **Pin a version** (`__RENPLAY_VERSION__` above; use the newest from the
  [releases](https://renplay.org/releases)) instead of `latest`, so an upgrade
  happens when you decide. See [Upgrading](/upgrading/).
- The same image is on Docker Hub as `renplay/renplay`.
- `ghcr.io/renplay-org/renplay:edge` is built from every change on the `dev` branch. It is for
  trying things, not for a library you care about.

## Plain Docker

```sh
docker run -d --name renplay --restart unless-stopped -p 8080:8080 \
  -v /path/to/games:/games \
  -v /path/to/data:/data \
  ghcr.io/renplay-org/renplay:__RENPLAY_VERSION__
```

## The two folders

| Folder | What is in it |
|---|---|
| `/data` | Saves and their history, the library, mods, covers, walkthroughs. **Back this up.** |
| `/games` | Installed games, and `_archives/`, where game downloads are dropped. Renplay can rebuild installed games from the archives, while they are kept. |

Keep both on local disks if you can. Network shares work, but creating many small files is slow on
them; see [Troubleshooting](/troubleshooting/#network-storage-is-slow).

The container can also run with a read-only root filesystem: it writes only to `/games`, `/data`
and `/tmp`. Add `read_only: true` and `tmpfs: [/tmp]` to the Compose service if you want that.

## Options

Everything works without configuration. See [Configuration](/configuration/) for the environment
variables.

## Check that it runs

```sh
curl http://localhost:8080/api/health
docker logs renplay
```

Next: [Add a game](/guides/adding-games/).
