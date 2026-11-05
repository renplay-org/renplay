---
title: FAQ
description: Short answers to common questions.
---

## Which games work?

Ren’Py 8 games, and most Ren’Py 7 games: they run on the Ren’Py 8 engine, and only games with
Python 2-only code have trouble. The [catalog](/catalog/) lists games that were tested, and most
others work too. HTML games such as Twine stories play too, shown as Beta. See
[Engines](/engines/).

## Where do I get games?

From their developers: itch.io, Patreon, Steam and so on. Renplay and its catalog never host game
files.

## Can I keep playing on desktop Ren’Py?

Yes. Export a game’s saves (or all of them in Settings) and they work in the desktop version, and
the other way round. See [Playing](/guides/playing/).

## Is there a mobile app?

No. Renplay is a web page that works on phones. On iPhone, add it to the Home Screen.

## Does it need the internet?

Your server needs it to fetch the catalog, covers and engines. The player can use the cached engine
and game, but a game that is not cached in the browser must be downloaded from your server.

## Does it have user accounts?

Yes. Local accounts keep saves, favourites and progress separate. New installs require sign-in;
upgrades keep it off until you enable it. See [Accounts](/accounts/). OIDC, LDAP and avatars follow
later.

## Can I keep adult games out of sight?

Yes. Set `RENPLAY_ADULT_GAMES=block`. See [Adult games](/start-here/adult-games/).

## Can I change a game’s title or cover?

No. Titles, developers, tags and covers come from the catalog, so every install looks the same. If
something is wrong, fix the recipe: see [Catalog and recipes](/catalog/).

## Is my game run on the server?

No. Renplay needs no Ren’Py SDK, and the game’s code never runs there. It runs in your browser.

## Will uninstalling delete my saves?

No. Uninstalling and reinstalling never touch saves, and every overwrite keeps history.

## How much disk space do I need?

About as much as the downloads. Installed images are converted to WebP, which is usually smaller.
Delete the archives after installing (the default) to save space, or keep them to be able to
reinstall.

## Where do I ask something?

Questions, such as whether a game works, go to
[Discussions](https://renplay.org/discussions); bugs to
[issues](https://renplay.org/issues). For a failed install, attach the job log
from **Settings** → **Activity**.

## Who makes Renplay?

The Renplay Team. It is free and open source under the MIT license. If it is useful to you, you can
[support it](https://renplay.org/support).
