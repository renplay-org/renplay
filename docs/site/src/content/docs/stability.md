---
title: Stability
description: The installation contract Renplay keeps throughout 3.x.
---

Renplay 3.x keeps the installation contract below. Store packages for TrueNAS, Unraid,
Umbrel and CasaOS can rely on it, as can your own Compose file. New features may add options;
existing names and meanings stay supported throughout 3.x.

## Images and network

- **Images:** `ghcr.io/renplay-org/renplay` and `docker.io/renplay/renplay` contain the same
  releases, for Linux amd64 and arm64. Pin a release tag, or its digest. `latest` follows releases;
  `edge` on GHCR follows development and is not part of the stability promise.
- **Port:** HTTP on **8080** inside the container. Map any host port you like.
- **Health:** unauthenticated `GET /api/health` through port 8080. The image includes a Docker
  health check. It checks both nginx and the application, not just a running process.
- **One instance:** run one container against a library, never multiple writers.

## Storage

| Path | Contract |
|---|---|
| `/data` | Saves, save history, accounts, SQLite library database, mods and cached metadata. **Use local disk and back it up. SQLite must not be on a network share.** |
| `/games` | Installed builds and `_renplay/` (engines and scratch space). This can be a network share. Installed builds can be recreated from the original downloads. |
| `/games/_archives` | Original game downloads, also called the archives folder. Optionally mount a separate downloads folder here, or set `ARCHIVES_DIR`. |
| `/tmp` | Disposable writable temporary space, including nginx state, HOME and caches. Provide a writable tmpfs when the root filesystem is read-only. |

An install needs about **twice the game's download size free** while building, sometimes more
for highly compressed archives. `/data` is usually small compared with `/games`, but save history,
mods and the first upgrade backup need space too.

By default, only completed uploads through Renplay are deleted after a successful install.
Downloads you copied into the archives folder are **never automatically deleted**, nor are old
archives with an unknown origin. Set `RENPLAY_DELETE_ARCHIVES=false` to keep uploads too.
Uninstalling or reinstalling a game never deletes its saves.

## Users and permissions

The image defaults to **1000:1000**, without root. Any non-root numeric user and group works:
for example `--user 568:568` on TrueNAS, or `user: "99:100"` in Compose. The mounted folders
must already be writable by that identity. No passwd entry is needed.

For Unraid's convention, start with `--user 0:0 -e PUID=99 -e PGID=100`. The entrypoint uses
`setpriv` to drop to those IDs before starting either Node or nginx. Root without these variables
drops to 1000:1000. `PUID=0` is refused. When started non-root, `PUID` and `PGID` are ignored.
Renplay does not recursively change ownership of your volumes or downloads share.

Both modes support a read-only root filesystem with writable `/data`, `/games` and `/tmp`.
See the [Docker examples](/install/docker/).

## Environment variables

Every variable in [Configuration](/configuration/) is part of the 3.x contract: folder overrides,
accounts and sign-in, catalog and engine sources, image conversion, save history, proxy options,
and container `PUID` and `PGID`. Existing variables will not be renamed or removed in 3.x.
New variables may be added. The names frozen for 3.0 are:

- Folders: `DATA_DIR`, `GAMES_DIR`, `ARCHIVES_DIR`, `RENPLAY_DIR`, `SAVES_DIR`,
  `SAVE_HISTORY_DIR`, `OVERLAYS_DIR`.
- Accounts: `RENPLAY_AUTH`, `RENPLAY_AUTH_USER`, `RENPLAY_AUTH_LOCAL`,
  `RENPLAY_ADMIN_USERNAME`, `RENPLAY_ADMIN_PASSWORD`, `RENPLAY_ADMIN_PASSWORD_FILE`,
  `RENPLAY_ADULT_DEFAULT`.
- Games: `RENPLAY_DELETE_ARCHIVES`, `RENPLAY_ADULT_GAMES`, `RENPLAY_CATALOG_URLS`,
  `RENPLAY_ENGINES_URL`, `RENPLAY_ENGINE`.
- Images and saves: `RENPLAY_IMAGE_QUALITY`, `RENPLAY_IMAGE_CONCURRENCY`, `RENPLAY_SAVE_HISTORY`.
- Proxy: `RENPLAY_PUBLIC_URL`, `RENPLAY_TRUSTED_HOPS`, `RENPLAY_KEEPALIVE_URL`,
  `RENPLAY_KEEPALIVE_HOST`.
- Server and container: `PORT`, `PUID`, `PGID`.

Defaults and security fixes are described in the release notes; set explicit values when your
package depends on a particular choice.

`PORT` configures the internal Node server, not the container's public port. Leave it at 3000
in the supplied image; nginx uses that port. Runtime details such as `NODE_OPTIONS`, `HOME`,
`XDG_CACHE_HOME`, `LD_PRELOAD` and `UV_THREADPOOL_SIZE` are not application settings.

## Addresses

Renplay is served from the root of its origin, not a configurable URL prefix:

- `/` and library navigation paths serve the web UI.
- `/api/` serves the API; `/api/health` is the public health endpoint.
- `/g/<game>/<build>/` serves a game page; its `game.zip` and `game/…` assets stay beneath it.
- `/engine/<version>/…` serves shared web engine files.
- `/renplay/runtime.js` serves the in-game runtime.

These prefixes stay supported in 3.x. Build IDs and signed asset URLs are generated by Renplay;
packages should not construct them or depend on internal file formats. Authentication still applies
where required; stable addresses do not mean public access. Use the API's returned play URL.

## Upgrades and backups

Database migrations only move forward. **A 3.x release never requires manual upgrade steps**;
if an upgrade needs operator action, it will be a major version with instructions in the release
notes. Stop the old container, back up `/data`, and start the new release on the same volumes.
Never run the two versions at once.

The move from 2.11.1 to 3.0 backs up the old database, saves and history under
`/data/backups/pre-3.0/`, moves saves into the owner account, and leaves compatibility links.
CI tests upgrade from 2.11.1, downgrade to it, and upgrade again without losing the fixture library,
save or history. This does not promise arbitrary future downgrades: migrations are not reversed.
For a general rollback, restore the matching backup as well as the old image.

Read [Upgrading and backups](/upgrading/) before updating a library you care about.
