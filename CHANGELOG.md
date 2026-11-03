# Changelog

All notable changes to Renplay. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versions follow [Semantic Versioning](https://semver.org/): a minor version adds features, a
patch version fixes things, and a major version needs something from you when you upgrade (the
release notes say what).

## [Unreleased]

### Added

- Downloads are deleted once their game installs, to save space. Set `RENPLAY_DELETE_ARCHIVES=false`
  to keep them for reinstalls. A failed or cancelled install keeps the download.
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
  [renplay-web/engines](https://github.com/renplay-web/engines) and shared by games.
- Curated catalog ([renplay-web/catalog](https://github.com/renplay-web/catalog)) with recipe
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

[Unreleased]: https://github.com/renplay-web/renplay/compare/v2.4.0...dev
[2.4.0]: https://github.com/renplay-web/renplay/compare/v2.3.0...v2.4.0
[2.3.0]: https://github.com/renplay-web/renplay/compare/v2.2.0...v2.3.0
[2.2.0]: https://github.com/renplay-web/renplay/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/renplay-web/renplay/compare/v0.1.1...v2.1.0
[0.1.1]: https://github.com/renplay-web/renplay/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/renplay-web/renplay/releases/tag/v0.1.0
