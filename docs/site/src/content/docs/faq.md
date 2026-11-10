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

Yes. Export a game’s saves (or all of yours from **Account**) and they work in the desktop version,
and **Import from a computer** brings them back. Games made with Ren’Py 8.1 or newer can also move
saves with a Sync code. See [Playing](/guides/playing/).

## Is there a mobile app?

No. Renplay is a web page that works on phones. On iPhone, add it to the Home Screen.

## Does it need the internet?

Your server needs it to fetch the catalog, art and engines. A game you play streams from your
server. Choose **Keep offline** on a game's page and it plays from that browser with no network at
all, and its saves are sent when you are back. See [Play offline](/guides/playing/#play-offline).

## Can I play with a controller?

Yes. The d-pad moves around Renplay, and in a game the controller plays through Ren’Py’s own
buttons. **Menu** opens the player menu. See [With a controller](/guides/playing/#with-a-controller).

## Does it have user accounts?

Yes. Accounts keep saves, favourites, ratings and play history separate. Sign in with a password,
single sign-on (OpenID Connect) or LDAP. New installs require sign-in, and upgrades keep it off until
you enable it. On a shared tablet, **Who is playing?** switches person with a PIN. See
[Accounts](/accounts/).

## Can I keep adult games out of sight?

Yes. Set **Highest level for everyone** in **Settings** (or `RENPLAY_ADULT_GAMES`) to Off to hide
them for everyone, or Blurred to show them without pictures. Each person chooses their own level on
their account page, and **Hide adult games here** in the account menu hides them on a shared screen.
See [Adult games](/start-here/adult-games/).

## Can I change a game’s title or art?

The art, yes: **Change art** on a game's page picks another picture or uploads your own, for you or,
as an admin, for everyone. Titles, developers and tags come from the catalog, so every install shows
the same. If something is wrong, fix the recipe, or keep your own in
[Your recipes](/catalog/#your-recipes).

## Is my game run on the server?

No. Renplay needs no Ren’Py SDK, and the game’s code never runs there. It runs in your browser.

## Will uninstalling delete my saves?

No. Uninstalling and reinstalling never touch saves, and every overwrite keeps history.

## How much disk space do I need?

About as much as the downloads, and as much again while you keep them. Installed images are
converted to WebP, which is usually smaller. Downloads are kept by default so a game can be
reinstalled. **Settings → Storage → Show what uses space** shows what each game takes and deletes
downloads you no longer need.

## Where do I ask something?

Questions, such as whether a game works, go to
[Discussions](https://renplay.org/discussions), and bugs to
[issues](https://renplay.org/issues). For a failed install, attach the job log
from **Activity**.

## Who makes Renplay?

The Renplay Team. It is free and open source under the MIT license. If it is useful to you, you can
[support it](https://renplay.org/support).
