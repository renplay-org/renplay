---
title: Catalog and recipes
description: How the catalog gives games their title, art and settings, and how to request or add one.
---

The catalog is a public list of **recipes**. A recipe says which download of a game works in the
browser and how to build it. It is published at `https://catalog.renplay.org/index.v4.json` and the
source is the [catalog repository](https://renplay.org/github/catalog).

Everything about a game that Renplay shows comes from its recipe: title, developer, tags, links,
summary and development state. You cannot edit these in Renplay, so every install shows the same
things. The recipe also gives the game's **art**, which you can change for yourself, and an admin
for everyone (see below).

## Art

A recipe links the game's pictures in five formats, the shapes SteamGridDB uses:

| Format | Size | Where it shows |
|---|---|---|
| Grid | 600 × 900 | The library tiles and the game page poster |
| Wide | 920 × 430 | Up next and wide tiles |
| Hero | 1920 × 620 | The top of the game page and the background behind it |
| Logo | A transparent PNG | The game's title on the stage |
| Icon | A square, 512 and up | Small rows such as History |

Pictures come from Steam, itch.io, SteamGridDB (credited to their author), the developer, or the
Renplay Team. Renplay downloads each one once, checks it against the catalog's checksum, and keeps
it in its own data folder, so art keeps working when those sites are down. A format the recipe does
not have is made from the others: a crop around the part that matters, a composition (a poster on a
soft background, for example), or the picture whole on a glow of its own colours. Made pictures
never contain text.

The game page says where its art came from. SteamGridDB art names its author, linked to the
picture's page.

## How matching works

When you add a game, Renplay compares it with the recipes by, in order of how sure it is:

1. the **sha256** of the download,
2. file **name and size**,
3. a **`match` pattern** in the recipe, for developers whose file names follow a pattern, so new
   versions are recognized before they are listed.

An installed game also links to its recipe by id, archive or save folder. A game with no recipe
still installs and plays, without art or a title beyond its file name, and Renplay still tries
its best to find the save folder.

## Status and updates

Each release in a recipe has a status:

| Status | Meaning |
|---|---|
| `verified` | Plays through without problems |
| `playable` | Works, with issues listed in the notes |
| `broken` | Does not work, and why |

When a newer working release than yours is listed, Renplay says an update exists. Older releases stay
in the recipe, because people still have those files.

The catalog refreshes every 6 hours, or press **Refresh** in **Settings** → **Catalog**. You can use
your own indexes with `RENPLAY_CATALOG_URLS`; see [Configuration](/configuration/).

## Request a game

If a game is missing, does not work, or works but is not listed:
[open a request](https://renplay.org/catalog/request). Say which download you
used. For a game that fails to install or play, report a broken game the same way.

## Write a recipe

1. Download the game’s PC version from its official source, install it in Renplay and play past the
   first chapter. Check images, music and video, save, load, and resume.
2. In **Settings** → **Catalog**, choose the game and press **Export recipe**. It fills in the id,
   save folder, engine versions and the archive’s size and checksum.
3. Add the developer, links, tags and `nsfw`, set `status`, and add the art.
4. Save it as `recipes/<id>.yaml` in the catalog repository, run `npm ci && npm run build`, and open
   a pull request.

The full guide, including **art rules** (official art, linked and not copied, adult art never in
the repository) and when a game needs `build.keep`, `build.exclude` or a patch, is in
[CONTRIBUTING.md of the catalog](https://github.com/renplay-org/catalog/blob/main/CONTRIBUTING.md).

## Never game files

Recipes point to the official download. The catalog never hosts a game.

## Safe-for-work index

Next to `index.v4.json` the catalog publishes `index.v4.sfw.json` without adult games. Renplay reads
it when the installation's adult games level is Off. Renplay 3.x reads `index.v3.json`, which stays
published until 3.x is retired. See [Adult games](/start-here/adult-games/).
