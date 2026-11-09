---
title: Upgrading
description: Versions, database migrations, backups and rollback.
---

## Versions

Renplay follows [Semantic Versioning](https://semver.org/):

- a **patch** version (4.5.0 to 4.5.1) fixes things,
- a **minor** version (4.5 to 4.6) adds features,
- a **major** version (4.x to 5.0) needs something from you when you upgrade. The release notes say
  what.

The [releases](https://renplay.org/releases) page lists what changed in each
version, and the [changelog](https://github.com/renplay-org/renplay/blob/main/CHANGELOG.md) has the
same text. Read it before a minor or major upgrade.

## How to upgrade

1. **Back up `/data`.** See below.
2. Change the image tag in your Compose file or manifest to the new version.
3. Pull and restart: `docker compose pull && docker compose up -d`.
4. Open Renplay and check the library and a save.

Installed games keep working across upgrades. A new version may build games differently, and that
only affects games you install or reinstall afterwards.

## Database migrations

The library database (`/data/library.db`) is migrated when the new version starts. Do not assume an
older version understands a newer schema. In general:

- Always back up `/data` before upgrading.
- To roll back, stop Renplay, restore the backup of `/data` from before the upgrade, and start the
  older image. Without a backup you cannot roll back.
- Migrations never rewrite save contents.

## Backups

`/data` is what to back up: saves and their history, the library database, mods, covers and
walkthroughs. Stop Renplay, or take a snapshot of the volume, so the database is copied whole.

Installed games can be rebuilt while their downloads are kept. Downloads live in the optional
`/downloads` mount, an explicit `ARCHIVES_DIR`, or `/games/_archives`. Downloads are kept by
default. `RENPLAY_KEEP_DOWNLOADS=true` locks that choice. Back up downloads you cannot get again.
Deleting `/games` also deletes downloads stored inside it. Games whose downloads were deleted
must be added again, but their saves are safe in `/data`.

### Daily save backups

Once a day Renplay also writes a zip of everyone's saves to `/data/backups/saves` and keeps the
newest 14. Set `RENPLAY_BACKUP_DIR` to a folder on another disk or a share to keep that copy apart
from `/data`, `RENPLAY_BACKUP_KEEP` for how many to keep, or `RENPLAY_BACKUP_DIR=off` to turn them
off. A server that sleeps when idle makes the backup the next time it runs. **Settings** lists the
backups with a download link and has **Back up now**. To restore a game's saves, import its folder
from the zip on the game's page, under **Saves**.

## Upgrading within 4.x

No action is needed: the database updates itself on the first start. Going back to the release
before works too (see [Stability](/stability/#upgrades-and-going-back)).

A library from before 4.0 opens in Renplay 4.5.1 first: start 4.5.1 on it once, then the newest
version.

## An important change in an earlier release line

Older versions read the catalog and engines from addresses that no longer exist (they moved to
`catalog.renplay.org` and `engines.renplay.org`). Upgrade to the first version with the new
addresses to refresh the catalog and download new engines. Games already installed keep working
meanwhile. Images moved to `ghcr.io/renplay-org/renplay`; the old image path gets no new tags.
