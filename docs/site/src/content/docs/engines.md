---
title: Engines
description: Which game engines Renplay plays, and how an engine is added.
---

Renplay is a player for Ren'Py games. HTML games, such as Twine stories, play too: they are shown as
Beta in the app and get the features that come cheap. When a feature works for Ren'Py and not for
HTML games, that is fine.

## Support

| Engine | Plays | Notes |
|---|---|---|
| Ren'Py 8, and 7 on the 8 engine | yes | Everything: saves on the server, streaming, phones, offline, controllers, mods |
| HTML games: Twine (SugarCube, Harlowe), RPG Maker MV and MZ, TyranoScript, plain pages | Beta | Web pages already. Tested with Twine (SugarCube). RPG Maker MV and MZ and TyranoScript take the same path but are untested |
| Everything else | no | Programs made for one system, such as RPG Maker XP, VX and VX Ace, Wolf RPG, Kirikiri, GameMaker, Unreal, and Unity or Godot PC builds, cannot run in a browser |

Add games shows every download with the engine that made it, and the reason when it cannot be
installed. An engine is added only when its normal download plays as easily as an HTML game.

## Ren'Py 7 games

Renplay builds games made with Ren'Py 7 (and older) on the Ren'Py 8 engine, which loads their
compiled scripts. Ren'Py 8 marks the Python in those scripts as Python 2, and Renplay rewrites that
code as it compiles, so it behaves as it did: `7 / 2` is 3, `keys()`, `map()` and `zip()` give
lists, sorting mixed values works, and `cmp`, `long`, `iteritems`, `string.letters`,
`__cmp__` and `__nonzero__` are there. Python 2 statements (`print x`, `except E, e`, `exec`) are
fixed where they fail to compile. The game's own `.py` files get the same treatment. Games made with
Ren'Py 8 are left exactly as they are. If such a game still stops with a Python error, check the
[catalog](/catalog/) for a note, and see
[Troubleshooting](/troubleshooting/#a-renpy-7-game-stops-with-a-python-error).

Renplay picks the engine for a game from its recipe, then `RENPLAY_ENGINE`, then the newest stable engine
of the game's major version. A pre-release engine, which the engine index marks, is picked only for a
game made with a newer Ren'Py than every stable engine, so no other game moves onto it. See [Configuration](/configuration/).

## HTML games

| Feature | Ren'Py | HTML |
|---|---|---|
| Saves on the server | yes | `localStorage` synced |
| Streaming files on demand | yes | yes (the page fetches them) |
| WebP images | yes | yes |
| Mute | yes | yes (Web Audio and media elements) |
| Phones | yes | depends on the page |
| Offline, mods, script cache | yes | no |

## How an engine plugs in

This part is for developers.

Each engine needs four things. Everything else (library, art, the player's toolbar, saves panel,
fullscreen, mute, wake lock, phones) is shared.

1. **Detect** (`server/src/pipeline/family.ts`, `detectEngine`): family, version, the folder the
   game lives in, its start file, from the file names in an archive and a few bytes of its files.
   `INSTALLABLE` lists the families this version installs.
2. **Build**: put the game's files into a build (`assets.pack` and its index, as for Ren'Py), so
   they are served with byte ranges and long caching. Converting images to WebP works for any
   engine that loads images by name. Streaming on demand works where the engine fetches files
   itself, as HTML games do.
3. **Runtime**: a small script in the game's frame that tells the player when the game is ready,
   keeps its saves on the server, and handles mute. Ren'Py's is `runtime/renplay-runtime.js`,
   HTML games' is `runtime/renplay-html.js`, and both start with `runtime/renplay-player.js`, what
   they share: messages to the player, muting and Esc in fullscreen.
4. **Player**: the shared player, with the features the runtime supports.

## Security

A Ren'Py build runs Ren'Py's engine, which Renplay ships. HTML games run their own JavaScript. In a
frame on Renplay's origin, that code could call Renplay's API (delete saves, uninstall games). So
HTML games run in a **sandboxed frame** (`sandbox="allow-scripts"`, no `allow-same-origin`): an
opaque origin with no access to Renplay's cookies, storage or API. The runtime talks to the player
only with `postMessage`.

An opaque origin has no `localStorage` or IndexedDB either, so the runtime provides them:

- A `localStorage` stand-in backed by the server's save store, loaded before the game's scripts run
  (SugarCube and RPG Maker keep saves there).
- An in-memory IndexedDB (`runtime/vendor/fake-indexeddb.js`, bundled by
  `runtime/vendor/build.sh`) for games that keep databases (RPG Maker MZ through localforage). The
  runtime restores the stored databases before the game's scripts run, and after every write sends
  a snapshot (`indexedDB.json` in the save folder, binary data and dates keeping their type).
- Cache Storage (`window.caches`) throws in a sandboxed frame, so the runtime makes it absent.

Ren'Py games can also run JavaScript (Ren'Py's `emscripten` module), so moving them into the same
sandbox is worth doing later. Their saves already go through the runtime.

## Recipes

Recipes say which engine made the game:

```yaml
engine: html           # renpy (default) | html
releases:
  - version: "1.2"
```

`saveDir` keeps its name. What it means depends on the engine: Ren'Py's `config.save_directory`, or
a SugarCube story's save id. The catalog still publishes schema 2 as `index.json` for Renplay 2.5
and older (Ren'Py games only) and schema 3 as `index.v3.json` for Renplay 2.6 to 3.x.
`normalizeRecipe` in `shared/recipe.ts` reads all of them.
