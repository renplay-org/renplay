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
soft background, for example), or the picture whole on a glow of its own colours. A crop from a
picture of another format never enlarges it more than about twice: a small store header becomes a
glow of its colours rather than a blurry background. Made pictures never contain text.

The game page says where its art came from. SteamGridDB art names its author, linked to the
picture's page.

**Change art** on a game's page (or **Details**, under the art) opens the art picker, one format at a time.
Every choice is shown as it will look in place. Your choice changes only what you see. An admin
can choose for everyone, which beats the catalog's default, and each person's own choice still wins
for them. **Use the default** goes back. You can upload your own picture: the sizes above work
best, and another size is accepted with a warning and cropped around the point you tap. Uploads stay
on your server. Pictures of adult games below Shown cannot be changed. The picker
lists your uploads with **Delete**, up to ten pictures of each format per game.

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
your own indexes with `RENPLAY_CATALOG_URLS`. See [Configuration](/configuration/).

## Tags

Tags on the **Catalog** page can be included or left out: a tap includes a tag (only games that have
it), the next leaves it out (games that have it are hidden), the next clears it. **All tags** lists
every tag by group, with how many games have it. Your choices are kept with your account, on every
device. An admin can set the tags left out for everyone who has not chosen
([Defaults for everyone](/accounts/#defaults-for-everyone)).

## Your recipes

A folder of recipe files on your server is read as one more catalog: `/data/recipes`, or the folder
in `RENPLAY_RECIPES_DIR`. Use it to fix a game's recipe or add one without waiting for the catalog.

- Files are in the catalog's own format, one per game: `<id>.yaml`, the id matching the file's
  name. Files whose names start with `_` or `.` are skipped, so `_template.yaml` can sit there.
- A recipe with the id of a catalog recipe takes its place.
- Art and patches can be files in the folder: `art: [{ kind: grid, file: art/my-game/grid.png }]`,
  patches under `patches/<id>/`. Recipe files are read up to 1 MB, pictures up to 16 MB and patches
  up to 64 MB, and nothing outside the folder is followed.
- A recipe without an `nsfw` line counts as an adult game.
- **Settings → Catalog** lists each source, the catalog and Your recipes, with its recipes and any
  problems: a file that is not valid YAML, an unknown tag, a picture that could not be read.

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
