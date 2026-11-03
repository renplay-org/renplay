# Engines

Renplay is a player for Ren'Py games. Other engines are second-class citizens: Renplay recognizes
them, installs the ones a browser can run, and gives them the features that come cheap. When a
feature works for Ren'Py and not for another engine, that is fine.

## Support

| Engine | Recognized | Installs | Notes |
|---|---|---|---|
| Ren'Py 8, and 7 on the 8 engine | yes | yes | Everything: saves on the server, streaming, phones, mods |
| HTML: Twine (SugarCube, Harlowe), RPG Maker MV and MZ, TyranoScript, Construct, plain pages | yes | yes (2.6) | Web pages already. Tested with Twine (SugarCube); RPG Maker MV/MZ, TyranoScript and Construct take the same path but are untested |
| Godot 4 | yes | phase 3 | Godot's own web export template loads the game's `.pck`. Native plugins (GDExtension) and C# do not run in browsers |
| Unity WebGL builds | yes | phase 4 | Only builds the developer made for WebGL |
| Unity PC builds | yes | never | Compiled for one system; a browser cannot run them |
| RPG Maker XP, VX, VX Ace; Wolf RPG; Kirikiri; GameMaker; Unreal | yes | never | Windows (or PC) programs |
| Flash (`.swf`) | yes | maybe | [Ruffle](https://ruffle.rs) plays many Flash games in a browser |

`server/src/pipeline/family.ts` does the recognizing (`detectEngine`), from the file names in an
archive and a few bytes of its files: Godot's pack header gives the version, a Twine page names its
story format, RPG Maker's core script its version, Unity's `globalgamemanagers` its version.
`INSTALLABLE` lists the families this version installs. Add games shows every download with what
made it, and the reason when it cannot be installed.

## How an engine plugs in

Each engine needs four things; everything else (library, covers, the player's toolbar, saves
panel, fullscreen, mute, wake lock, phones) is shared.

1. **Detect** (`family.ts`): family, version, the folder the game lives in, its start file.
2. **Build**: put the game's files into a build (`assets.pack` and its index, as for Ren'Py), so
   they are served with byte ranges and long caching. Converting images to WebP works for any
   engine that loads images by name; streaming on demand works only where the engine fetches
   files itself (HTML games do; Godot and Unity load one big pack).
3. **Runtime**: a small script in the game's frame that tells the player when the game is ready,
   keeps its saves on the server, and handles mute. Ren'Py's is `runtime/renplay-runtime.js`.
4. **Player**: the shared player, with the features the runtime supports.

| Feature | Ren'Py | HTML | Godot | Unity WebGL |
|---|---|---|---|---|
| Saves on the server | yes | `localStorage` synced | `user://` synced | `persistentDataPath` synced |
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
- Godot and Unity: both are Emscripten builds that keep files in IndexedDB (`IDBFS`). The runtime
  mounts their save folder in memory and syncs it to the server, the way Ren'Py's runtime does.

Ren'Py games can also run JavaScript (Ren'Py's `emscripten` module), so moving them into the same
sandbox is worth doing later; their saves already go through the runtime.

## Catalog schema 3

Recipes say which engine made the game. Schema 3 names (`index.v3.json`, Renplay 2.6 and later):

```yaml
engine: godot          # renpy (default) | html | godot | unity
runtime: 4.6.2         # web runtime to build with, from renplay-web/engines (optional)
releases:
  - version: "0.17.0"
    madeWith: 4.6.2    # version of the engine the game was made with
    runtime: 4.6.2     # per release, instead of the recipe's (optional)
```

`saveDir` keeps its name; what it means depends on the engine (Ren'Py's `config.save_directory`, a
Godot project's `user://` folder name, a SugarCube story's save id). The catalog still publishes
schema 2 as `index.json` for Renplay 2.5 and older: Ren'Py games only, with the runtime as
`engine` and a release's `madeWith` and `runtime` as `renpy` and `engine`. `normalizeRecipe` in
`catalog.ts` reads both.

The engines repository will list other runtimes (Godot's web export templates, one per version)
with a `family` field; entries without one are Ren'Py.

## Plan

1. **Recognize** (done in 2.6): detection, schema 3, Add games lists other engines with reasons.
2. **HTML** (done in 2.6 for Twine): `pipeline/html.ts` packs the game's folder (images as WebP
   under their own names); the page is served from the pack with `runtime/renplay-html.js` and the
   stored `localStorage` (`<save folder>/localStorage.json`) inlined first; the player sandboxes the
   frame and stores what the runtime sends. Tested with College Daze (SugarCube 2.36.1): plays in
   Chromium and WebKit, a save made in one browser loads in another, the game cannot reach
   Renplay's API. Next: an RPG Maker MV or MZ game (MZ keeps saves with localforage, which falls
   back to `localStorage` when IndexedDB is missing).
3. **Godot 4**: the single-threaded web template per version, picked from the pack header. Test
   game: Sexting sim stories (Godot 4.6.2, 1.2 GB pack, a native plugin). Its web template loads
   the whole pack into memory, so packs over about 1 GB may not fit on phones; the plugin will be
   missing, so expect parts of it to fail.
4. **Unity WebGL**: serve the build as it is. Needs a game that publishes a WebGL build.

Later candidates, by how many adult games use them: TyranoScript and Construct (HTML, so phase 2
may cover them), Flash through Ruffle, NW.js and Electron apps whose content is a web page.
