---
title: Adult games
description: How Renplay handles adult games, and the safe-for-work mode.
---

Many visual novels are adult. Renplay plays them, and it lets you keep them out of sight.

## The choice

The choice is made once for the whole install:

| `RENPLAY_ADULT_GAMES` | What happens |
|---|---|
| `allow` | Adult games show. The choice is locked. |
| `block` | Safe-for-work mode. Adult games do not show, and the choice is locked. |
| not set | A new install asks once, in the empty library. An existing library keeps showing adult games. You can change the choice in Settings. |

Any other value counts as `block`, because that is the safe reading of a typo.

## What safe-for-work mode does

- The catalog is read from its safe-for-work index, so adult games and their covers never reach
  your server. If a catalog has no such index, Renplay fetches the full one and drops the adult
  recipes.
- Adult games already in your library are hidden. Nothing is deleted, and switching back brings
  them back. A game with no catalog recipe is not hidden, because Renplay cannot tell what it is.
- Downloads of known adult games are refused with a plain reason.

One limit: the web server hands out files of installed games, such as `game.zip`, straight from
disk. A hidden game’s files stay reachable by their exact address. Do not treat this mode as
access control.

## Pictures in the browser

Separately, each browser decides whether to show adult pictures. They start hidden in a new
browser: covers become title cards and save pictures become scene cards, and the hidden art is not
fetched. Change this under **Settings** → **This browser**.

## In these docs

The docs never show adult art. Screenshots are of safe-for-work games or blurred.
