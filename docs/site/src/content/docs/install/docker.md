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
- **Pin a version** (`__RENPLAY_VERSION__` above. Use the newest from the
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

## Storage folders

| Folder | What is in it |
|---|---|
| `/data` | Saves and their history, the library, mods, covers, walkthroughs. **Back this up.** |
| `/games` | Installed games, engines and scratch space. Scratch stays on this filesystem for atomic installs. Without a separate downloads mount, this also holds `_archives/`. |
| `/downloads` | Optional downloads and drop folder. Mount your downloads share here to keep it separate from installed games. |

**Keep `/data` on local disk.** Its SQLite database must not be on a network share. `/games`
and the optional archives folder can be shares. See
[Troubleshooting](/troubleshooting/#network-storage-is-slow). Allow about twice a game's download
size free while it installs. Downloads are kept by default so games can be reinstalled.
In Settings, turn off **Keep downloads** to delete only uploads through Renplay after successful
installs. Files copied in are never deleted automatically. `RENPLAY_KEEP_DOWNLOADS=true` or
`false` sets and locks this choice. `RENPLAY_DELETE_ARCHIVES` is still supported as a deprecated
alias with the opposite value.

To keep downloads on another disk, add `- /path/to/downloads:/downloads` under Compose
`volumes`, or `-v /path/to/downloads:/downloads` to `docker run`. Make it writable by the
container user. Renplay uses `/downloads` when it exists and is writable, or an explicit
`ARCHIVES_DIR` when set. Otherwise it keeps using `/games/_archives`. Existing files are never
moved. Settings shows the folder in use.

Deleting `/data` loses saves and the library. Deleting `/games` loses installed games and also
its downloads unless you mounted them separately. Games can be rebuilt only while you keep the
downloads. Deleting a download saves space, but reinstalling then needs that download again.
Admins can use **Delete download** on a game's **Manage** tab without touching installed files or saves. **Settings → Storage → Show what uses space** lists every game's build, other builds and download, the engines, and folders that belong to no game, and frees space from there.

The container can also run with a read-only root filesystem: it writes only to `/games`, `/data`,
`/tmp` and the optional downloads mount. Add `read_only: true` and `tmpfs: [/tmp]` to the Compose service if you want that.

## Other user IDs

To use the owner of your folders directly, add `user: "568:568"` to the Compose service,
or `--user 568:568` to `docker run`. Arbitrary non-root IDs work without a passwd entry.
Make both mounted folders writable by that user and group first.

For Unraid's `PUID`/`PGID` convention, use:

```yaml
    user: "0:0"
    environment:
      PUID: "99"
      PGID: "100"
```

The entrypoint drops root with `setpriv` before starting the application or nginx. Starting as root
without those variables drops to 1000:1000. `PUID=0` is refused. When started non-root, both
variables are ignored. Renplay never changes the ownership of your mounted folders.

## Options

Everything works without configuration. See [Configuration](/configuration/) for the environment
variables.

## Check that it runs

```sh
curl http://localhost:8080/api/health
docker logs renplay
```

Next: [Add a game](/guides/adding-games/).

The image names, ports, paths and upgrade promise are covered by the
[3.x stability contract](/stability/).
