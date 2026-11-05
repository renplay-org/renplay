---
title: Accounts
description: Sign-in, separate saves, shared libraries and moving between accounts.
---

Renplay 3.0 adds local accounts. Everyone shares the games, but saves, save history, favourites,
Finished, play time and last played belong to each person. HTML games' stored progress is separate
too. Admins manage games and users; players play and manage their own saves.

## First start

A new data folder requires sign-in. Open Renplay and enter the **Setup code** from the server log:

```sh
docker logs renplay | grep "Setup code"
```

Choose the owner's name, username and password (at least 10 characters). The owner keeps any saves
made before sign-in was enabled. The code changes on each server start and allows ten attempts;
restart Renplay if those attempts run out.

To seed the owner instead, set `RENPLAY_ADMIN_USERNAME` and `RENPLAY_ADMIN_PASSWORD_FILE` (a file
containing the password). `RENPLAY_ADMIN_PASSWORD` also works. Set only one password source. These
variables claim an unclaimed owner, not reset an existing password.

Sign-in stays off after an upgrade, with an admin reminder. Set `RENPLAY_AUTH=on` and restart when
ready. The first admin claims the owner and all the saves made without sign-in.

## Sign-in and sessions

Sign-in lasts 30 days from your last use. The account menu shows your name, the adult-picture
preference, and **Sign out**. If sign-in ends during play, the player asks you to sign in in another
tab. Return and press **Continue** to sync without losing the scene. Use the same account that
started that game. A shared browser never uploads another account's queued saves. Unsent Ren'Py
and HTML saves stay on that device under their owner's account until the same account returns.
HTML games sync a returning account's pending changes before opening again; connect and retry
if that sync fails. Do not clear browser storage while changes are waiting to sync.

Browser saves from before accounts are attributed only to the known owner of an upgraded
single-user installation, never to an arbitrary player. If their owner cannot be established,
Renplay keeps them and shows a notice. Ask an admin to recover those files on the same device;
[developer recovery notes](/developers/accounts-api/#unowned-browser-save-recovery) explain how.

Use HTTPS outside a trusted local network. Cookies are httpOnly and SameSite=Lax; they also have
`Secure` over HTTPS, but work on plain HTTP for local NAS installs. Set `RENPLAY_PUBLIC_URL` to
your HTTPS address when a proxy terminates HTTPS. See [Reverse proxy and HTTPS](/install/reverse-proxy/).

## Without sign-in

`RENPLAY_AUTH=off` lets everyone play as the owner (account 1). `RENPLAY_AUTH_USER` can choose a
different account id. Nothing moves when you change the mode. Other accounts' saves stay in their
folders and return when sign-in is enabled again.

Without sign-in, everyone has the chosen account's permissions. Keep an open admin account on a
trusted network or behind your own authentication. Disabling sign-in is not a way to separate people.

## Adult games

The instance's choice still comes first. An admin grants adult access per account; new accounts
are blocked unless `RENPLAY_ADULT_DEFAULT=allow`. The first admin has access. Games with no recipe
count as adult for restricted accounts until an admin marks them safe.

The account menu has **Show**, **Hide pictures** (the default) and **Hide adult games**. **Settings →
This browser** can override that choice on this device, but cannot grant access the account lacks.
See [Adult games](/start-here/adult-games/).

## Admin tools in this stage

The sign-in and setup screens are included. Full Account and Users screens follow in stage B;
until then the [server endpoints](/developers/accounts-api/) manage users, passwords, sessions,
access tokens and save transfers.

An admin can copy one game's saves or all save folders to another account, merge accounts, or
export and import a whole save folder as a zip. Overwrites go into the target's history. Removing
or merging an account archives its folder under `/data/users-removed/`; Renplay does not purge it.
The owner and the account selected for no-sign-in play cannot be removed.

Save imports accept up to 200 files, 64 MiB per uploaded file and 128 MiB per request. A zip may
contain at most 2,048 entries, 64 MiB per expanded entry and 128 MiB of expanded contents. Links,
special files and unsafe paths are refused before extraction. Two imports can run at once;
try again shortly if another import is using the available slots.

## Backups and rollback

Back up all of `/data`, including `/data/users/` and `/data/users-removed/`. Each user folder has a
`user.json` identifying its owner. The upgrade first backs up saves, save history and `library.db`
under `/data/backups/pre-3.0/`, then moves the old folders under `/data/users/1/`. It leaves symlinks
at the old paths, including custom `SAVES_DIR` and `SAVE_HISTORY_DIR` paths.

The migration resumes after an interruption, and copies and verifies when the folders live on
another volume. Conflicting files from an interrupted partial copy stay in the owner's
`migration-conflicts/` folder. The filesystem must support symlinks; otherwise startup stops rather
than silently leaving an incompatible old layout. Keep your own backup as well.

Renplay 2.10 can still use the old owner save paths through those symlinks. It cannot see other
accounts. Do not run both versions at once. See [Upgrading](/upgrading/) for the general rollback rule.
