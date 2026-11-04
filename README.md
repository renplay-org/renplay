<p align="center"><img src="docs/logo.svg" width="88" alt=""></p>

<h1 align="center">Renplay</h1>

<p align="center"><b>Your Ren’Py and HTML games in the browser, on any device, with saves on your own server.</b></p>

<p align="center">
  <a href="https://github.com/renplay-org/renplay/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/renplay-org/renplay?color=e0306f"></a>
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-7c5cff"></a>
  <a href="https://renplay.org/support"><img alt="Support on Ko-fi" src="https://img.shields.io/badge/support-Ko--fi-fb7aa8?logo=kofi&logoColor=white"></a>
</p>

<p align="center"><a href="https://docs.renplay.org">Documentation</a> · <a href="https://renplay.org">Website</a> · <a href="https://renplay.org/github/catalog">Catalog</a></p>

<p align="center"><img src="docs/screenshots/desktop-library.webp" alt="The Renplay library with two games and a Continue playing banner" width="880"></p>

Renplay is a self-hosted library for the visual novels you download: [Ren’Py](https://www.renpy.org/)
games first, and HTML games such as Twine stories too. Add a game’s normal PC download, press
Install, and play it in any browser: on your computer, your tablet or your phone. Every save lands
on your server the moment you make it, so you can stop on the laptop and continue on the phone.
Other engines are added only when their normal download plays as easily; the
[docs](https://docs.renplay.org/engines/) say what works.

<p align="center">
  <img src="docs/screenshots/phone-library.webp" alt="The library on a phone" width="260">
  &nbsp;
  <img src="docs/screenshots/phone-game.webp" alt="A game page on a phone" width="260">
</p>

## What you get

- **Play anywhere.** Smooth, full-speed playback in the browser. On phones the game fills the
  screen around the camera cutout, and on iPhone it runs full screen from the home screen.
- **Saves on your server.** Saves, autosaves and progress sync as you play, with earlier versions
  kept. Sequels find the previous season’s saves, just like on desktop. Import saves from the
  desktop version, export them back, or copy them between games.
- **One-click installs.** Drop in the PC zip (or 7z, rar). Renplay unpacks it, shrinks the images
  and prepares it for the web. No Ren’Py SDK, and the game’s code never runs on your server.
- **A curated catalog.** Known games get their proper title, cover, links and tested settings from
  the [catalog](https://renplay.org/github/catalog), and Renplay tells you when a newer tested
  version exists.
- **Resume in one tap.** Up next opens your latest save straight away, with play time and your
  last save on the library home. Mark a story Finished on its game page to leave it out of Up next;
  its saves stay safe.
- **Pictures stay private.** Adult pictures start hidden in a new browser. Covers become title
  cards and saves become scene cards, without fetching the hidden art. Catalog covers marked safe
  for work stay visible. Change this browser's preference in Settings → This browser.
- **Find your next game.** Keep favourites at the top of your library, sort by last played,
  title or recently added, and search titles, developers and tags. Recent combines last played and
  recently added. Library filters stay in the
  address so Back brings them back. The catalog has search and tag filters too; game pages show
  summaries, development state and optional content tags.
- **Mods.** Browse a game’s files, edit scripts in the browser, or upload a mod. Your changes stay
  separate from the game and survive updates.
- **Fast to start.** Games and the engine are cached in your browser, assets stream as the game
  needs them, and compiled scripts are kept, so a big game starts in seconds.

## Install

Renplay is one container. Give it a folder for games and one for data:

```sh
docker run -d --name renplay -p 8080:8080 \
  -v /path/to/games:/games \
  -v /path/to/data:/data \
  ghcr.io/renplay-org/renplay:latest
```

Open http://localhost:8080. Copy a game’s PC download into `/path/to/games/_archives/`, or upload
it under **Add games**, and press **Install**. The first install also downloads the Ren’Py web
engine (about 16 MB).

The same image is on Docker Hub as `renplay/renplay`. Pin a version
(`ghcr.io/renplay-org/renplay:2.9.1`) for production; [releases](https://renplay.org/releases)
list what changed. Renplay has no user accounts, so put it behind your own sign-in (a reverse
proxy with authentication, a VPN) if it is reachable from outside your network.

More in the docs: [Docker Compose](https://docs.renplay.org/install/docker/),
[Kubernetes](https://docs.renplay.org/install/kubernetes/),
[adding games](https://docs.renplay.org/guides/adding-games/),
[playing on your phone](https://docs.renplay.org/guides/playing/),
[configuration](https://docs.renplay.org/configuration/) (every environment variable),
[upgrading and backups](https://docs.renplay.org/upgrading/) and
[troubleshooting](https://docs.renplay.org/troubleshooting/).

**Back up `/data`:** it holds your saves and their history, the library, mods and covers. Everything
else can be rebuilt from the game downloads.

## Questions

**Which games work?** Ren’Py 8 games, and most Ren’Py 7 games. HTML games such as Twine stories
play too, marked Beta. See [Engines](https://docs.renplay.org/engines/) and the
[catalog](https://renplay.org/github/catalog), which lists games that were tested.

**Where do I get games?** From their developers: itch.io, Patreon, Steam and so on. Renplay and
its catalog never host game files.

**Can I keep playing on desktop Ren’Py?** Yes. Export a game’s saves and they work in the desktop
version, and the other way round.

More in the [FAQ](https://docs.renplay.org/faq/).

## For developers

- [Docs](https://docs.renplay.org): [how Renplay works](https://docs.renplay.org/developers/architecture/)
  and [contributing](https://docs.renplay.org/developers/contributing/)
- [CONTRIBUTING.md](CONTRIBUTING.md): the short version
- [AGENTS.md](AGENTS.md): product rules and lessons learned, for people and AI agents alike
- [CHANGELOG.md](CHANGELOG.md): what changed in each version
- Related: [catalog](https://renplay.org/github/catalog) (recipes and covers),
  [engines](https://renplay.org/github/engines) (Ren’Py web engines),
  [website](https://renplay.org)

## Support

Questions, such as whether a game works, go to
[Discussions](https://renplay.org/discussions); bugs to
[issues](https://renplay.org/issues).

Renplay is made by the Renplay Team. It is free and open source. If it is useful to you, you can
support it on [Ko-fi](https://renplay.org/support).

## License

[MIT](LICENSE). Ren’Py is © Tom Rothamel and contributors, under its own license. Games belong to
their developers.
