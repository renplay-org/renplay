---
title: Upgrading
description: Versions, database migrations, backups and rollback.
---

## Versions

Renplay follows [Semantic Versioning](https://semver.org/):

- a **patch** version (2.9.1 to 2.9.2) fixes things,
- a **minor** version (2.9 to 2.10) adds features,
- a **major** version (2.x to 3.0) needs something from you when you upgrade. The release notes say
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

## Database migrations only go forward

The library database (`/data/library.db`) is migrated when the new version starts. Migrations move
forward only: **an older version cannot read a database a newer version has migrated.** So:

- Always back up `/data` before upgrading.
- To roll back, stop Renplay, restore the backup of `/data` from before the upgrade, and start the
  older image. Without a backup you cannot roll back.
- Migrations never change save files.

## Backups

`/data` is what to back up: saves and their history, the library database, mods, covers and
walkthroughs. Stop Renplay, or take a snapshot of the volume, so the database is copied whole.

`/games` does not need a backup of its own: installed games can be rebuilt from `/games/_archives`,
as long as the archives are kept (`RENPLAY_DELETE_ARCHIVES=false`). Games whose archives were
deleted must be added again, but their saves are safe in `/data`.

## An important change in this release line

Older versions read the catalog and engines from addresses that no longer exist (they moved to
`catalog.renplay.org` and `engines.renplay.org`). Upgrade to the first version with the new
addresses to refresh the catalog and download new engines. Games already installed keep working
meanwhile. Images moved to `ghcr.io/renplay-org/renplay`; the old image path gets no new tags.
