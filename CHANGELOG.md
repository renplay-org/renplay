# Changelog

All notable changes to Renplay. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versions follow [Semantic Versioning](https://semver.org/): a minor version adds features, a
patch version fixes things, and a major version needs something from you when you upgrade (the
release notes say what).

## [Unreleased]

## [2.10.0] - 2026-11-04

### Added

- A library home with Up next, your latest save and play time, shelves for favourites and new
  games, updates and interrupted installs. Mark a story Finished to leave it out of Up next.
- A Recent sort that brings together newly added and recently played games.
- Favourite games from their page and find them together at the top of your library. Favourites
  stay when a game is uninstalled.
- Sort the library by last played, title or recently added, and filter it by tag. Search, filters
  and sorting come back when you go Back.
- Search and tag filters in the catalog.
- Game pages show the catalog's summary, whether the game is ongoing, completed, on hold or
  abandoned, and its tags, with content tags tucked away until you open them.
- An empty library suggests a free starter game when the catalog has one.
- Long lists of games and activity load more as you ask for them.
- Choose whether this Renplay shows adult games. A new install asks once in the empty library, and
  Settings changes it later. Safe-for-work only hides adult games, refuses their downloads and
  leaves the library and saves untouched. Servers can fix the choice with `RENPLAY_ADULT_GAMES`.
  Existing libraries keep showing adult games.

### Changed

- Renplay moved to its own domain, renplay.org. It reads the catalog from catalog.renplay.org and
  engines from engines.renplay.org, and its links go through renplay.org. **Upgrade to this
  version:** older versions read both from addresses that no longer exist, so they cannot refresh
  the catalog or download a new engine (games already installed keep working).
- The image is `ghcr.io/renplay-org/renplay` (the organization was renamed), and also on Docker
  Hub as `renplay/renplay`.
- Games show the version the catalog gives their release ("0.9.23") instead of the text inside
  the download, and update offers follow the same release.
- Tags come from the catalog's fixed list; the library shows the ones your games share.
- Hidden adult covers show title cards instead of blurred art, and save pictures show scene
  cards. Adult pictures start hidden in browsers without a saved preference; covers marked safe
  by the catalog stay visible.
- Game pages put progress and updates above saves, with a play button that stays within reach
  on phones. Save and file actions open as bottom sheets on phones.
- Add games puts uploads, server downloads and the catalog together, without tabs. Update
  actions name the game they update, and deleting a download is in its actions menu.
- The player's sideways hint carries loading progress, and its saves open as a bottom sheet
  on phones.
- Settings separates General, This browser and About, and Activity groups work by day.
- Activity groups repeated attempts and names the download being processed.
- Settings shows relative update times and game titles beside each engine.

### Fixed

- An install into a game that is not in the library is refused at once, instead of after it
  has unpacked the whole download.
- Portrait phones show the sideways hint while a game is still loading, and the player keeps its
  Save & exit label.
- Game details no longer show a save folder for HTML games.

## [2.9.1] - 2026-11-04

### Changed

- Renplay says what it plays: Ren'Py games first, and HTML games too (README, the app's Add games
  page and empty library, the web app's description).

## [2.9.0] - 2026-11-03

### Added

- Unity WebGL games and Godot web builds install and play, like HTML games: in a sandboxed frame,
  with their saves on the server. Tested with NaughtyPhone (Unity 6) and Diggz for Vex (Godot 4.7).
  On itch.io these are the versions that play in the browser.
- Games of engines other than Ren'Py are marked Beta in the library, on their page and in Add
  games: they work, with fewer features.
- Games that keep their saves in IndexedDB (Unity, Godot, RPG Maker MZ, and others) keep them on the
  server: the sandboxed frame gets an in-memory IndexedDB that is restored before the game starts
  and stored after every write.

### Changed

- Godot PC downloads say to use the game's web build instead.

## [2.8.0] - 2026-11-03

### Changed

- Games of other engines are named the way players know them from F95zone: HTML (SugarCube 2.36.1),
  RPGM (MZ 1.8.0), Unity, Godot.
- The catalog's games are not labeled Verified or Known issues any more: being in the catalog means
  a game works. A release that does not work still says so.

### Fixed

- A game installed from a catalog recipe uses the recipe's save folder; Renplay's own guess from the
  game's options came first and could be wrong (Hero's Harem Guild).

## [2.7.1] - 2026-11-03

### Fixed

- HTML games stay installed when Renplay restarts. The startup check looked for a `game.zip`,
  which only Ren'Py builds have, and marked them not installed; reinstall them once.

## [2.7.0] - 2026-11-03

### Changed

- Ren'Py games load the scripts their developer compiled (`.rpyc`) instead of compiling their
  sources again on the newer engine. Older games start faster, and games whose sources the newer
  engine refuses start at all (Heros Harem Guild). The sources stay in the build for mods. This
  applies to games installed or reinstalled from now on.
- Builds stand in for more of what desktop games expect and a browser lacks: import hooks of
  old libraries (`six`, bundled with old versions of `requests`), the Unix sockets Discord status
  libraries look for, and Python 2 numbers with leading zeros (`02`, `010`).

### Fixed

- In HTML games on phones, the player's menu button is in the top right, so the game's own menu
  in the top left (SugarCube's sidebar) can be opened.

## [2.6.0] - 2026-11-03

### Added

- HTML games install and play: Twine stories (tested with SugarCube), and RPG Maker MV and MZ,
  TyranoScript and Construct games, untested so far. They play in a sandboxed frame that cannot
  reach Renplay, with their saves (the browser storage they use) kept on the server, so they
  follow you to other devices. Mute, fullscreen and Save & exit work; save slots, mods and the
  script cache are for Ren'Py games only.
- Add games says what made each download. Downloads of engines Renplay cannot install are listed
  apart with the reason: Godot (with its version, and a warning about native plugins), Unity (WebGL
  and PC builds), and engines that only make PC programs. Godot and Unity WebGL support is planned;
  `docs/engines.md` has the plan.
- A game's Details tab says what made it.

### Changed

- Ren'Py 7 games' Python print statements (`print "…"`) work: code that fails to compile on the
  Ren'Py 8 engine for that reason is compiled again with print() calls. Games that depend on other
  Python 2 behaviour still fail; Harem Hotel (Ren'Py 7.4) is one.
- Renplay reads the catalog's schema 3 (`index.v3.json`), where recipes say which engine made the
  game (`engine`), the runtime to build with (`runtime`) and the engine version a release was made
  with (`madeWith`). It still reads schema 2. Exported recipes use the new names.

### Fixed

- Games made with Ren'Py 7.4 to 7.5 that ship only Python 2 show their Ren'Py 7 version, not 8.0.

## [2.5.0] - 2026-11-03

### Added

- Downloads are deleted once their game installs, to save space. Set `RENPLAY_DELETE_ARCHIVES=false`
  to keep them for reinstalls (before upgrading, if you reinstall games often). A failed or
  cancelled install keeps the download.
- A mute button in the player's toolbar. It mutes every game in this browser, like muting a tab, and
  leaves the game's own volume settings alone.
- In fullscreen, a hint says how to leave it, and holding Esc shows a ring that fills until
  fullscreen ends (1.5 seconds, as in Chrome).
- Games that go online for news or updates start: builds include stand-ins for Python's `ssl`
  module and for threads, which browsers do not have. Moonripple Lake opened on an error before.

### Changed

- Add games is simpler: Upload is part of Downloads, which lists downloads ready to install with
  their catalog cover and a progress bar while they install, and those already installed apart.
  The catalog shows compact cards with where to get each game, and links to requesting a game.
- Downloads show the same details in the same order. Ones looked into by an older version are
  looked into again, so Ren'Py 7 games show their Ren'Py version.
- Exported recipes start with the catalog's schema line, so editors check them as you type.

### Fixed

- Reinstall is offered only while the game's download is still on the server.
- .7z and .rar downloads no longer say "No Ren'Py game found" (Renplay looks inside them only
  when it installs them).

## [2.4.0] - 2026-11-03

### Added

- Games made with Ren'Py 7 install and play on the Ren'Py 8 engine instead of being refused. Most
  work; Python 2-only code in a game can fail while playing. Once in a Lifetime (Ren'Py 7.3.2)
  plays through without problems.

### Changed

- Install logs show progress every half minute (how much is read, files written, images
  converted), and their times follow the server's time zone (`TZ`).
- The catalog is refreshed every hour while Renplay runs, not only at startup.
- Games made with Ren'Py 7, and Ren'Py 8.0 games built for both Pythons, show their Ren'Py version
  instead of "unknown".

## [2.3.0] - 2026-11-03

### Added

- In fullscreen, Esc opens the game's menu (Chrome and Edge); hold Esc to leave fullscreen. Other
  browsers keep Esc for leaving fullscreen, and right-click opens the menu.

### Fixed

- Menus and in-game screens with many small elements run smoothly. Ripples' main menu went from 15
  to 60 frames per second: the browser no longer waits on the graphics card before every element.

### Removed

- Installing from a download link. File hosts tie their links to the browser (and network) that
  opened them, so the server's download failed for most links. Upload the download, or copy it
  into the archives folder; the Upload tab now explains where that is.

## [2.2.0] - 2026-11-03

### Added

- Play on phones. The library has a tab bar and single-column pages. The player sizes the game from
  the screen's real visible area and safe area (camera cutout, rounded corners, home indicator) and
  follows rotation. Fullscreen holds landscape on Android; on iPhone, where Safari cannot make a
  page fullscreen, the player explains Add to Home Screen. Portrait shows a rotate hint, touch
  screens get a menu button, and the screen stays on while you play.
- Official cover art from the catalog, shown the way stores show thumbnails, with the title below.
  Art of another shape is shown whole over a blurred copy, so logos are never cut off. A game
  without a recipe shows a tile with its title.
- Blur pictures of adult games (Settings › This browser), for screens other people can see.
- "Update" on games the catalog lists a newer working release for.
- Links to the source code and to Ko-fi in the footer.

### Changed

- Title, developer, tags and cover come from the game's catalog recipe and cannot be edited.
  Installed games find their recipe by id, archive or save folder, so a recipe added later applies
  without a reinstall.
- The install dialog no longer asks for a title or image settings; the recipe decides.
- Consistent sentence case ("Renplay", "Installed", tags).
- Activity moved from the navigation to a progress indicator in the header and to Settings.
  Recipe export moved to Settings › Catalog.

### Removed

- Editing a game's title, tags and save folder, uploading covers, and covers picked from game
  files. Renplay 2.1 covers are deleted on the first catalog refresh.
- Ren'Py's own menu inside games (browser-local save import and export, which Renplay replaces).
  Its log download moved to the player's Display panel.

### Fixed

- No more blue outline around the game when you click or press a key.
- The Activity page shows an install's image savings again.

## [2.1.0] - 2026-11-03

The first release since 0.1: a rebuild of the whole app.

### Added

- Saves on the server: every save, autosave and persistent change is uploaded when the game writes
  it, with history. One shared save tree like desktop Ren'Py, so sequels import the previous
  season's saves. Import and export saves from and to desktop Ren'Py; copy saves between games.
- Installs from the PC download without the Ren'Py SDK: RPA archives are split while streaming,
  images converted to WebP, and the web build is assembled by Renplay. Streamed files are stored in
  one pack per build, which keeps installs fast on network storage.
- Official Ren'Py web engines per version, downloaded on demand from
  [renplay-org/engines](https://github.com/renplay-org/engines) and shared by games.
- Curated catalog ([renplay-org/catalog](https://github.com/renplay-org/catalog)) with recipe
  export.
- Mods: browse a game's files, edit scripts in the browser, upload files or a mod zip; changes are
  kept as a separate layer.
- A new library and player: resume from the latest save, fit and fill scaling, MacBook notch
  handling, auto-hiding toolbar, walkthrough PDFs.

### Changed

- Smooth playback: frames are paced to the display (about 8 → 60 fps in tested games).
- Faster starts: the engine is downloaded compressed and cached; Python bytecode and scripts
  recompiled for the newer engine are kept with the build (Pale Carnations: loading the scripts
  went from 17 to 1.5 seconds).
- Interrupted game downloads resume instead of hanging.

### Removed

- Ren'Py 7 games: their web engine is a different system and is not supported yet.

## [0.1.1] - 2026-06-04

### Fixed

- Release pipeline: image tags and builds on `main`.

## [0.1.0] - 2026-06-03

### Added

- First release: a game selector and the build and test pipelines.

[Unreleased]: https://github.com/renplay-org/renplay/compare/v2.10.0...dev
[2.10.0]: https://github.com/renplay-org/renplay/compare/v2.9.1...v2.10.0
[2.9.1]: https://github.com/renplay-org/renplay/compare/v2.9.0...v2.9.1
[2.9.0]: https://github.com/renplay-org/renplay/compare/v2.8.0...v2.9.0
[2.8.0]: https://github.com/renplay-org/renplay/compare/v2.7.1...v2.8.0
[2.7.1]: https://github.com/renplay-org/renplay/compare/v2.7.0...v2.7.1
[2.7.0]: https://github.com/renplay-org/renplay/compare/v2.6.0...v2.7.0
[2.6.0]: https://github.com/renplay-org/renplay/compare/v2.5.0...v2.6.0
[2.5.0]: https://github.com/renplay-org/renplay/compare/v2.4.0...v2.5.0
[2.4.0]: https://github.com/renplay-org/renplay/compare/v2.3.0...v2.4.0
[2.3.0]: https://github.com/renplay-org/renplay/compare/v2.2.0...v2.3.0
[2.2.0]: https://github.com/renplay-org/renplay/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/renplay-org/renplay/compare/v0.1.1...v2.1.0
[0.1.1]: https://github.com/renplay-org/renplay/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/renplay-org/renplay/releases/tag/v0.1.0
