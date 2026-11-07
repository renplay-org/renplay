---
title: Adult games
description: The three levels for adult games, Off, Blurred and Shown, and who sets each one.
---

Many visual novels are adult. Renplay plays them, and it lets every person decide how much of
them they see.

## Three levels

| Level | What it means |
|---|---|
| **Off** | Adult games do not exist. They are left out of the library, the catalog, search, Add games, Activity and every count. Nothing is blurred or tagged, there is simply nothing there. |
| **Blurred** | Adult games show with their titles and details, and they play, with their walkthroughs and your save files. Their pictures do not: covers become title cards with an 18+ tag, save pictures become a soft blur of their colours, and loading pictures are hidden. The server never sends one of those pictures to that person, only a few dozen bytes that describe the blur. |
| **Shown** | Adult games show with their pictures. |

Safe-for-work games are never affected at any level.

## Four layers that only narrow

Each layer can choose any level, but never more than the layer above it allows.

1. **This installation.** Set with `RENPLAY_ADULT_GAMES=off|blurred|shown`, which fixes it, or
   in **Settings** by an admin when the variable is not set. A new install asks once, in the empty
   library. The 3.x values still work: `allow` means Shown and `block` means Off.
2. **Your account.** The highest level for one person, set by an admin in **Settings → Users**.
   New people start at `RENPLAY_ADULT_DEFAULT` (Off unless you set it). The first admin starts at
   Shown. When a [sign-in group](/accounts/#group-driven-permissions) sets a level, the group
   decides and Users cannot change it.
3. **You.** Each person picks their own level on their **Account** page, at or below their
   account's. It applies on every device.
4. **This device.** A browser can go lower still, for example a phone you use in public. It is
   kept in that browser, for everyone who uses it, and the server applies it to everything it
   sends there.

**Account → Adult games** shows all four rows, says where each one comes from, and ends with one
sentence saying what you see and why. **Settings → This browser** has the device row too.

## What the installation level does on the server

- **Off:** the catalog is read from its safe-for-work index, so adult games and their pictures never
  reach your server. If a catalog has no such index, Renplay fetches the full one and drops the
  adult recipes. Adult games already in your library are hidden, not deleted. Their downloads are
  hidden and cannot be installed.
- **Blurred:** adult games are listed, but Renplay never downloads their pictures.
- **Shown:** everything is downloaded as usual.

Changing the level later brings everything back. Saves are never touched.

The server checks the level on every request, including game files, pictures and walkthroughs that
nginx serves straight from disk. Those static checks are cached for up to a minute, so a change can
take that long to reach them.

## Games without a recipe

A game Renplay cannot match to the catalog counts as adult for a person whose own levels are at
Off, until an admin marks it safe.

## Upgrading from 3.x

Renplay 4.0 turns the 3.x settings into levels:

- The install switch: allow becomes Shown, block becomes Off.
- A person with adult access gets Shown as their account's level, a person without gets Off.
- Their own level follows their 3.x picture preference: Show becomes Shown, Hide adult games
  becomes Off, and Hide pictures, the 3.x default, becomes Blurred.
- A browser that hid pictures keeps doing so, as this device's level.

The 3.x settings are kept in step, so going back to 3.2 shows the same games. Blurred has no 3.2
equivalent and reads as hidden pictures there.

## In these docs

The docs never show adult art. Screenshots are of safe-for-work games or blurred.
