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

Game files, covers and walkthroughs are checked too, including files nginx serves straight from
disk. Static permission checks are cached for up to a minute; changing access or signing out may
take that long for those files. Requests handled by the application check the account directly.

## Pictures in the browser

An admin separately grants adult access per [account](/accounts/). New accounts are blocked by
default (`RENPLAY_ADULT_DEFAULT=block`); the first admin has access. For restricted accounts,
games without recipes also count as adult until an admin marks them safe. This is enforced by
the server, including saves and play routes.

The account menu chooses **Show**, **Hide pictures** (the default) or **Hide adult games**. With
pictures hidden, covers become title cards and save pictures become scene cards; hidden art is
not fetched. **Settings → This browser** can override the account preference on one device.
A preference cannot grant access that the instance or account denies.

## In these docs

The docs never show adult art. Screenshots are of safe-for-work games or blurred.
