---
title: Engines
description: Which game engines Renplay plays, and how an engine is added.
---

Renplay is a player for Ren'Py games. Other engines are second-class citizens, shown as Beta in
the app: Renplay recognizes them, installs the ones a browser can run, and gives them the
features that come cheap. When a feature works for Ren'Py and not for another engine, that is
fine.

The focus is Ren'Py, plus engines whose normal download plays easily: HTML games today. Unity
WebGL and Godot web builds install and play too, but games rarely offer them as a download (on
itch.io they are the in-browser versions), so the catalog and the website leave them out.

## Support

| Engine | Recognized | Installs | Notes |
|---|---|---|---|
| Ren'Py 8, and 7 on the 8 engine | yes | yes | Everything: saves on the server, streaming, phones, mods |
| HTML: Twine (SugarCube, Harlowe), RPG Maker MV and MZ, TyranoScript, Construct, plain pages | yes | yes (2.6) | Web pages already. Tested with Twine (SugarCube); RPG Maker MV/MZ, TyranoScript and Construct take the same path but are untested |
| Godot 4 web builds | yes | yes (2.9) | The developer's single-threaded web export (on itch.io, the version that plays in the browser). Tested with a Godot 4.7.1 game. Threaded web builds need SharedArrayBuffer, which the sandbox cannot give |
| Godot 4 PC builds | yes | planned | Godot's own web template loads a PC `.pck` (tried), but games with native plugins (GDExtension) or C# cannot run in browsers |
| Unity WebGL builds | yes | yes (2.9) | The developer's WebGL build, served as it is. Tested with a Unity 6 game |
| Unity PC builds | yes | never | Compiled for one system. A browser cannot run them |
| RPG Maker XP, VX, VX Ace; Wolf RPG; Kirikiri; GameMaker; Unreal | yes | never | Windows (or PC) programs |
| Flash (`.swf`) | yes | maybe | [Ruffle](https://ruffle.rs) plays many Flash games in a browser |

`server/src/pipeline/family.ts` does the recognizing (`detectEngine`), from the file names in an
archive and a few bytes of its files: Godot's pack header gives the version, a Twine page names its
story format, RPG Maker's core script its version, Unity's `globalgamemanagers` its version.
`INSTALLABLE` lists the families this version installs. Add games shows every download with what
made it, and the reason when it cannot be installed.

## Ren'Py 7 games

Renplay builds games made with Ren'Py 7 (and older) on the Ren'Py 8 engine, which loads their
compiled scripts. A game that starts has no Python 2 syntax left to trip on. What can still fail
is Python 2 behaviour, such as `xrange`, `iteritems` or `unicode`, or sorting numbers together
with text. If such a game stops with a Python error, check the [catalog](/catalog/) for a note, and
see [Troubleshooting](/troubleshooting/#a-renpy-7-game-stops-with-a-python-error).

Renplay picks the engine for a game from its recipe, then `RENPLAY_ENGINE`, then the newest engine
of the game's major version. See [Configuration](/configuration/).

## How an engine plugs in

This part is for developers.

Each engine needs four things. Everything else (library, covers, the player's toolbar, saves
panel, fullscreen, mute, wake lock, phones) is shared.

1. **Detect** (`family.ts`): family, version, the folder the game lives in, its start file.
2. **Build**: put the game's files into a build (`assets.pack` and its index, as for Ren'Py), so
   they are served with byte ranges and long caching. Converting images to WebP works for any
   engine that loads images by name. Streaming on demand works only where the engine fetches
   files itself (HTML games do; Godot and Unity load one big pack).
3. **Runtime**: a small script in the game's frame that tells the player when the game is ready,
   keeps its saves on the server, and handles mute. Ren'Py's is `runtime/renplay-runtime.js`.
4. **Player**: the shared player, with the features the runtime supports.

| Feature | Ren'Py | HTML | Godot | Unity WebGL |
|---|---|---|---|---|
| Saves on the server | yes | `localStorage` synced | `user://` (IndexedDB) synced | IndexedDB synced (`/idbfs`, the game's own) |
| Streaming files on demand | yes | yes (the page fetches them) | no (one pack) | no (one data file) |
| WebP images | yes | yes | no (imported into the pack) | no |
| Mute | yes | yes (Web Audio and media elements) | yes (Web Audio) | yes (Web Audio) |
| Phones | yes | depends on the page | depends on the game | rarely |
| Mods, script cache, Python stand-ins | yes | no | no | no |

## Security

A Ren'Py build runs Ren'Py's engine, which Renplay ships. Other engines run the game's own
JavaScript. In a frame on Renplay's origin, that code could call Renplay's API (delete saves,
uninstall games). So games of other engines run in a **sandboxed frame** (`sandbox="allow-scripts"`,
no `allow-same-origin`): an opaque origin with no access to Renplay's cookies, storage or API. The
runtime talks to the player only with `postMessage`.

An opaque origin has no `localStorage` or IndexedDB either, so the runtime provides them:

- HTML games: a `localStorage` stand-in backed by the server's save store, loaded before the game's
  scripts run (SugarCube and RPG Maker keep saves there).
- IndexedDB: Godot and Unity keep files in it through Emscripten's IDBFS (Godot's `user://` at
  `/userfs`, Unity's at `/idbfs`), and games keep their own databases there too (a Unity game,
  RPG Maker MZ through localforage). The runtime puts an in-memory IndexedDB in place
  (`runtime/vendor/fake-indexeddb.js`, bundled by `runtime/vendor/build.sh`), restores the stored
  databases before the game's scripts run (IndexedDB serves a database's open requests in order,
  so the game's wait for these), and after every write sends a snapshot (`indexedDB.json` in the
  save folder. Binary data, dates and the like keep their type). Unity's download cache
  (`UnityCache`) is refused, so the game fetches again instead of holding it in memory.
- Cache Storage (`window.caches`) throws in a sandboxed frame. The runtime makes it absent, which
  loaders such as Unity's treat as no caching.

Ren'Py games can also run JavaScript (Ren'Py's `emscripten` module), so moving them into the same
sandbox is worth doing later. Their saves already go through the runtime.

## Catalog schema 3

Recipes say which engine made the game. Schema 3 names (`index.v3.json`, Renplay 2.6 and later):

```yaml
engine: godot          # renpy (default) | html | godot | unity
runtime: 4.6.2         # web runtime to build with, from renplay-org/engines (optional)
releases:
  - version: "0.17.0"
    madeWith: 4.6.2    # version of the engine the game was made with
    runtime: 4.6.2     # per release, instead of the recipe's (optional)
```

`saveDir` keeps its name. What it means depends on the engine (Ren'Py's `config.save_directory`, a
Godot project's `user://` folder name, a SugarCube story's save id). The catalog still publishes
schema 2 as `index.json` for Renplay 2.5 and older: Ren'Py games only, with the runtime as
`engine` and a release's `madeWith` and `runtime` as `renpy` and `engine`. `normalizeRecipe` in
`catalog.ts` reads both.

The engines repository will list other runtimes (Godot's web export templates, one per version)
with a `family` field. Entries without one are Ren'Py.

## Plan

1. **Recognize** (done in 2.6): detection, schema 3, Add games lists other engines with reasons.
2. **HTML** (done in 2.6 for Twine): `pipeline/html.ts` packs the game's folder (images as WebP
   under their own names). The page is served from the pack with `runtime/renplay-html.js` and the
   stored `localStorage` (`<save folder>/localStorage.json`) inlined first. The player sandboxes the
   frame and stores what the runtime sends. Tested with a SugarCube 2.36.1 game: plays in
   Chromium and WebKit, a save made in one browser loads in another, the game cannot reach
   Renplay's API. Next: an RPG Maker MV or MZ game (MZ keeps saves with localforage, which falls
   back to `localStorage` when IndexedDB is missing).
3. **Godot 4** (web builds done in 2.9): a single-threaded web export is a page with the engine
   (`<name>.wasm`, `<name>.js`) and the pack (`<name>.pck`). It installs like an HTML game, and
   the IndexedDB stand-in keeps `user://`. Tested with a Godot 4.7.1 game: plays, and its
   settings saved in one browser load in another. Threaded web exports need cross-origin
   isolation (SharedArrayBuffer), which the sandboxed frame does not have. They are refused with
   that reason. PC builds are planned, as follows.

   PC builds: the single-threaded web template per version, picked from the pack header.
   Tried on 2026-11-03 with Godot's official 4.6.2 `web_nothreads_release` template and the
   Windows `.pck` of a game (4.6.2, 1.2 GB), unchanged: the engine starts, renders
   with the Compatibility renderer (WebGL 2) and loads the game's scenes, so a PC pack works as
   it is. That game cannot run, though: its core is a native plugin (`phone_core`, class
   `KpsPhoneCore`) with no web build, and the start crashes without it. The whole pack is held in
   memory (1.3 GB of JavaScript heap for a 1.2 GB pack), so big packs will not fit on phones.
   Needs a Godot game without native plugins to finish this phase. Detection already warns
   about plugins and C#. `web_dlink_nothreads_release` loads GDExtensions, but only ones
   compiled for the web, which games do not ship.

   What building it takes, from that try:
   - **Runtime pack**: renplay-org/engines builds `godot-<version>` from the official
     `Godot_v<version>-stable_export_templates.tpz` (checked against the release's SHA512-SUMS):
     `godot.js`, `godot.wasm` (gzipped), the two audio worklets and Godot's license. The index
     lists them under a separate `runtimes` key with `family: "godot"`, so Renplay 2.7 and older,
     which read `engines`, never mistake them for Ren'Py. Pick the pack matching the `.pck`
     header's version, else the newest of the same minor version.
   - **Build**: the `.pck` goes into the assets pack as `game.pck`; the page is Renplay's own,
     starting `new Engine({ executable, mainPack: 'game/game.pck', persistentPaths: ['/userfs'] })`.
   - **Sandbox**: the engine files under `/engine/` need `Access-Control-Allow-Origin: *` (the
     sandboxed frame fetches the wasm and adds the audio worklets from an opaque origin).
   - **Saves**: the IndexedDB stand-in (done, see Security) covers `user://`.
4. **Unity WebGL** (done in 2.9): the build is served as it is and installs like an HTML game.
   One game's build from itch.io names its files `.br` but holds them uncompressed (itch.io
   unpacks uploads), so files ending in `.br` or `.gz` get the type of the name underneath and no
   encoding; Unity's loader takes them either way. Its photo bundles in `StreamingAssets` are
   fetched by the game itself. Tested: plays, and its progress saved in one browser loads in
   another. Unity PC builds cannot run in a browser.

Later candidates, by how many adult games use them: TyranoScript and Construct (HTML, so phase 2
may cover them), Flash through Ruffle, NW.js and Electron apps whose content is a web page.
