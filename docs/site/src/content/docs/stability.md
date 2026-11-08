---
title: Stability
description: The installation contract Renplay keeps throughout 4.x.
---

Renplay 4.x keeps the installation contract below. Your own Compose file and packages for NAS
systems can rely on it. New releases may add options, but the names and meanings below stay as they
are throughout 4.x.

## Images and network

- **Images:** `ghcr.io/renplay-org/renplay` and `docker.io/renplay/renplay` hold the same
  releases, for Linux amd64 and arm64. Pin a release tag, or its digest. `latest` follows releases.
  `edge` is an unreleased build for trying a change and is not part of this promise.
- **Port:** HTTP on **8080** inside the container. Map any host port you like.
- **Health:** `GET /api/health` on port 8080 answers without signing in. The image's Docker health
  check uses it, and it checks nginx and the application, not just a running process.
- **One instance:** run one container against a library, never two at once.

## Storage

| Path | Contract |
|---|---|
| `/data` | Saves, save history, accounts, the SQLite library database, mods and game art. **Use local disk and back it up. SQLite must not be on a network share.** |
| `/games` | Installed builds and `_renplay/` (engines and scratch space). This can be a network share. Installed builds can be made again from the original downloads. |
| `/downloads` | Optional folder for downloads, used when it exists and is writable, or when `ARCHIVES_DIR` names it. Existing files are never moved. |
| `/games/_archives` | Original downloads when there is no usable `/downloads`. |
| `/tmp` | Writable scratch space, including nginx state and caches. Give it a tmpfs when the root filesystem is read-only. |

An install needs about **twice the game's download size free** while it builds. Downloads are kept
by default, and files copied into the downloads folder are never deleted automatically.
Uninstalling or reinstalling a game never deletes its saves.

Deleting `/games` also deletes downloads kept in its `_archives` folder. Mount `/downloads`
separately to discard installed games and keep the downloads. Deleting `/data` loses saves and the
library.

## Users and permissions

The image runs as **1000:1000**, without root. Any non-root numeric user and group works, for
example `--user 568:568` on TrueNAS or `user: "99:100"` in Compose. The mounted folders must be
writable by that user. No passwd entry is needed.

For Unraid's convention, start with `--user 0:0 -e PUID=99 -e PGID=100`. The entrypoint drops to
those IDs before it starts anything. Root without them drops to 1000:1000, and `PUID=0` is refused.
Renplay never changes the ownership of your folders.

Both work with a read-only root filesystem and writable `/data`, `/games` and `/tmp`. See the
[Docker examples](/install/docker/).

## Environment variables

Every variable on [Configuration](/configuration/) is part of the contract: it keeps its name and
what it does throughout 4.x, and new ones may be added. Older spellings keep working.
Changed defaults and security fixes are in the release notes, so set a value explicitly when your
package depends on it.

`PORT` sets the internal Node server, not the container's port. Leave it at 3000 in the image,
where nginx expects it.

## Addresses

Renplay is served from the root of its address, not from a folder of it:

- `/` and the library's pages serve the interface.
- `/api/` serves the API, and `/api/health` the health check.
- `/g/<game>/<build>/` serves a game page, with its `game.zip` and `game/` files beneath it.
- `/engine/<version>/` serves the shared Ren’Py web engine.
- `/renplay/runtime.js` serves the in-game runtime.

Build IDs and signed game addresses are made by Renplay. Use the play address the API returns,
and do not build one yourself or depend on files inside `/data` and `/games`. A stable address still
needs sign-in where Renplay asks for it.

## Upgrades and going back

**A 4.x release never needs manual upgrade steps.** One that did would be a new major version, with
the steps in its release notes. Stop the old container, back up `/data`, and start the new release
on the same folders. Never run two versions at once.

Every change is tested on the way from the newest release to it, back to that release, and up
again, with saves, their history and everything people set unchanged. Going back further is not
promised, because database changes only move forward. Then restore the backup that matches the
older release. A library from before 4.0 opens in Renplay 4.5.1 first, then in the newest version.

Read [Upgrading and backups](/upgrading/) before updating a library you care about.
