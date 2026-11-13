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

The library database (`/data/library.db`) updates when Renplay starts. Additions leave it readable
by the previous release. Before each numbered migration, Renplay makes a complete database copy in
`library/` under the backups folder. It will not migrate if that copy fails. The log gives the copy's
path. These pre-migration copies are kept until you remove them.

- Always back up all of `/data` before upgrading.
- Going back one release works without restoring a backup. To go back further when an older release
  refuses the library, stop Renplay and restore a matching backup of `/data` before starting it.
- Migrations never rewrite save contents.

If only the database needs restoring, stop Renplay first. Keep the current `library.db` and any
`library.db-wal` and `library.db-shm` files together in a separate folder. Copy the chosen database
backup to `/data/library.db`, then start the matching release. Do not leave the old WAL or SHM files
beside the restored database. This restores library records, people and settings, not save files.

## Backups

`/data` is what to back up: saves and their history, the library database, mods, covers and
walkthroughs. Stop Renplay, or take a snapshot of the volume, so the database is copied whole.

Installed games can be rebuilt while their downloads are kept. Downloads live in the optional
`/downloads` mount, an explicit `ARCHIVES_DIR`, or `/games/_archives`. Downloads are kept by
default. `RENPLAY_KEEP_DOWNLOADS=true` locks that choice. Back up downloads you cannot get again.
Deleting `/games` also deletes downloads stored inside it. Games whose downloads were deleted
must be added again, but their saves are safe in `/data`.

### Daily save backups

Once a day Renplay writes a zip of everyone's saves to `/data/backups/saves` and a complete copy of
`library.db` in its `library/` subfolder. The database copy is safe while Renplay runs. The newest
14 save zips and 14 daily database copies are kept. Pre-migration copies are not pruned.

Set `RENPLAY_BACKUP_DIR` to a folder on another disk or a share to keep these copies apart from
`/data`, and `RENPLAY_BACKUP_KEEP` for how many daily copies of each kind to keep. Set
`RENPLAY_BACKUP_DIR=off` to turn daily backups off. Pre-migration copies are still required and go
to `/data/backups/saves/library` when daily backups are off. A server that sleeps when idle makes
the daily backup the next time it runs.

**Settings** lists the save zips with a download link and has **Back up now**, which also copies the
database. The System backups API (`GET /api/system/backups`) gives the newest database copy's path
in `library.path`. To restore a game's saves, import its folder from the zip on the game's page,
under **Saves**. These daily backups do not include save history, mods, covers or walkthroughs, so
keep a separate backup of all of `/data` too.

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
