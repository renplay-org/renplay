---
title: Catalog and recipes
description: How the catalog gives games their title, cover and settings, and how to request or add one.
---

The catalog is a public list of **recipes**. A recipe says which download of a game works in the
browser and how to build it. It is published at `https://catalog.renplay.org/index.v3.json` and the
source is the [catalog repository](https://renplay.org/github/catalog).

Everything about a game that Renplay shows comes from its recipe: title, developer, tags, links,
summary, development state and cover. You cannot edit these in Renplay, so every install shows the
same things.

## How matching works

When you add a game, Renplay compares it with the recipes by, in order of how sure it is:

1. the **sha256** of the download,
2. file **name and size**,
3. a **`match` pattern** in the recipe, for developers whose file names follow a pattern, so new
   versions are recognized before they are listed.

An installed game also links to its recipe by id, archive or save folder. A game with no recipe
still installs and plays, without a cover or a title beyond its file name, and Renplay still tries
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
3. Add the developer, links, tags and `nsfw`, set `status`, and add the cover.
4. Save it as `recipes/<id>.yaml` in the catalog repository, run `npm ci && npm run build`, and open
   a pull request.

The full guide, including **cover rules** (official art, linked and not copied, adult art never in
the repository) and when a game needs `build.keep`, `build.exclude` or a patch, is in
[CONTRIBUTING.md of the catalog](https://github.com/renplay-org/catalog/blob/main/CONTRIBUTING.md).

## Never game files

Recipes point to the official download. The catalog never hosts a game.

## Safe-for-work index

Next to `index.v3.json` the catalog publishes `index.v3.sfw.json` without adult games. Renplay reads
it when the installation's adult games level is Off. See [Adult games](/start-here/adult-games/).
