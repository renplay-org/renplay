---
title: Telemetry
description: The anonymous usage report Renplay sends once a day, what is in it and how to turn it off.
---

Renplay sends a small anonymous report once a day. It tells the maintainers which versions and
setups are in use, which catalog games install and play well, and what breaks, so the next release
can fix what matters. It is on by default. It holds counts, never names, titles, files or saves.

## Turn it off

- **In Settings:** an admin turns off **Send an anonymous usage report** in the **About** panel.
  Turning it off also forgets what was counted but not yet sent.
- **On the server:** set `RENPLAY_TELEMETRY=off`. The variable wins over the switch in Settings, and
  Settings then says the server fixes it. See [Configuration](/configuration/).

Off means nothing is counted for the report and nothing is sent. `RENPLAY_TELEMETRY_URL` changes
where the report goes, for a collector of your own.

## When it is sent

The first report goes 10 to 60 minutes after Renplay starts, then one every 24 hours plus up to an
hour. Each covers the last whole day (UTC). A report that cannot be sent is dropped, and Renplay
does not try that day again. Renplay ignores the answer.

## What is in it

**Instance.** A random identifier made once and kept in your library's settings. It is not linked
to you, your server's address or your accounts. It only lets the collector count installations.

**Setup**

| Field | What it holds |
|---|---|
| `version` | The Renplay version |
| `arch` | `arm64` or `x64` |
| `install` | How Renplay was installed: `image` (Docker, with or without Compose), `chart`, `source` or `demo` |
| `auth` | `off`, `password`, `oidc`, `ldap` or `mixed` |
| `adultInstall` | The installation's adult games level: `off`, `blurred` or `shown` |
| `uptimeDays` | Days since this start |
| `gamesGB`, `dataGB` | The size of the games and of the data folder, as a range such as `10-100` |

**Size.** `scale` holds how many `users`, `devices`, `games` (and how many are Ren’Py, HTML,
from the catalog or local), `saves` and `mods` there are, as numbers.

**Plays on the day.** `play` holds the number of play sessions and minutes played, and what players
said about each session: the kind of device (`phone`, `tablet` or `desktop`) and browser engine
(`webkit`, `blink` or `gecko`), how many ran from the home screen, offline, with a controller or in
fullscreen, how long a game took to load (the median and the slowest tenth, in seconds) and how
smoothly it ran (`under30`, `30to50` or `50up` frames a second).

**Features used on the day.** `features` holds how many walkthroughs were added, Sync codes used,
saves imported, art choices made, games kept offline, mod builds, catalog refreshes by hand and
changes to an adult games level.

**Games from the official catalog.** `catalog` has one entry for each game installed from
`catalog.renplay.org`, and for each one installed or played that day: its catalog id such as
`charm-studies`, the release, whether it is installed, installs that worked or failed (with the
seconds they took and the engine version), play sessions and minutes, and how many errors. A catalog
of your own and Your recipes are never named.

**Errors.** `errors` lists up to 50 problems in catalog games: the game's catalog id, whether it
happened when installing, playing or syncing, the first line of the message and how often. The first
line is cut to 200 characters, and anything in quotes, addresses, paths, email addresses, long
numbers and long codes is replaced by `<x>`. So `AttributeError: module 'a.b' has no attribute 'c'`
is sent as `AttributeError: module <x> has no attribute <x>`.

## What is never sent

- Names, usernames, email addresses, display names or avatars
- IP addresses, server addresses, file paths or folder names
- Titles, art, notes or names of games that are not in the official catalog (they are only counted)
- Save contents, save names, sync codes, tokens or passwords
- Anything a person typed

The request carries Renplay's name and version in its `User-Agent`, like Renplay's other requests to
renplay.org.

## What the collector keeps

- The instance identifier, with the first and last day it reported, its version, architecture,
  install kind, sign-in kind, adult games level and size ranges. It is used to count active and new
  installations, versions and setups.
- Counts for each day and catalog game (installed, installs, plays, errors), added up over all
  instances. They are **never linked to an instance**.
- Sums of the `scale`, `play` and `features` numbers for each day.

The collector never stores IP addresses and does not keep the reports themselves. Rows older than 400
days are deleted every day.

The collector's code is in this repository under [`telemetry/`](https://github.com/renplay-org/renplay/tree/main/telemetry),
and the report is built in `server/src/telemetry/`.
