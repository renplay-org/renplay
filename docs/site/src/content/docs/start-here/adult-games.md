---
title: Adult games
description: The three levels for adult games, Off, Blurred and Shown, your choice and who limits it.
---

Many visual novels are adult. Renplay plays them, and it lets every person decide how much of
them they see.

## Three levels

| Level | What it means |
|---|---|
| **Off** | Adult games do not exist. They are left out of the library, the catalog, search, Add games, Activity and every count. Nothing is blurred or tagged, there is simply nothing there. |
| **Blurred** | Adult games show with their titles and details, and they play, with their walkthroughs and your save files. Their pictures do not: covers become a soft blur of their colours, with the title and an 18+ tag, save pictures become a soft blur of their colours, and loading pictures are hidden. The server never sends one of those pictures to that person, only a few dozen bytes that describe the blur. |
| **Shown** | Adult games show with their pictures. |

Safe-for-work games are never affected at any level.

## Your choice, and who limits it

Each person chooses their level on their **Account** page, under **Adult games**: **Off**,
**Blurred** or **Shown**. It applies on every device. Levels above your limit cannot be chosen, and
one line says who sets that limit:

- **The installation.** An admin sets **Highest level for everyone** in **Settings**, or fixes it
  with `RENPLAY_ADULT_GAMES=off|blurred|shown`. A new install asks once, in the empty library.
  `allow` (Shown) and `block` (Off) work too.
- **An admin, for one person.** **Settings → Users** sets the highest level each person can have.
  New people start at `RENPLAY_ADULT_DEFAULT` (Off unless you set it). The first admin starts at
  Shown.
- **A sign-in group.** When a [sign-in group](/accounts/#group-driven-permissions) sets a level, the
  group decides and **Users** cannot change it.

Each limit only narrows the one above it: a person never sees more than the installation allows.

## A shared screen

A browser can show less than your choice, never more, for example a tablet the family shares or a
laptop you use in public. **Hide adult games here** in the account menu (under your picture) turns
them off in this browser in one tap, and **Show adult games here again** brings them back.
**Settings → This browser** has the same setting with Blurred too. It is kept in that browser, for
everyone who uses it, and the server applies it to everything it sends there. Your **Account** page
says when this browser shows less than your choice, with **Follow my choice here**.

## What the installation level does on the server

- **Off:** the catalog is read from its safe-for-work index, so adult games and their pictures never
  reach your server. If a catalog has no such index, Renplay fetches the full one and drops the
  adult recipes. Adult games already in your library are hidden, not deleted. Their downloads are
  hidden and cannot be installed.
- **Blurred:** adult games are listed, but Renplay never downloads their pictures.
- **Shown:** everything is downloaded as usual.

Changing the level later brings everything back. Saves are never touched. Lowering the
installation to Blurred or Off stops new downloads of adult art, and the art already made stays on
disk, served to nobody who may not see it.

The server checks the level on every request, including game files, pictures and walkthroughs that
nginx serves straight from disk. Those static checks are cached for up to a minute, so a change can
take that long to reach them.

## Games without a recipe

A game Renplay cannot match to the catalog counts as adult for a person whose own levels are at
Off, until an admin marks it safe.

## In these docs

The docs never show adult art. Screenshots are of safe-for-work games or blurred.
