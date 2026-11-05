---
title: Adding games
description: Upload a game or drop it in the archives folder, and what happens during an install.
---

A game’s normal **PC download** is what Renplay installs: a zip, 7z or rar of the Windows, Linux or
Mac release of a Ren’Py game, or the zip of an HTML game. Get it from the developer (itch.io,
Patreon, Steam and so on).

## Two ways to add a game

- **Upload.** Open **Add games** and choose the file. Large files are sent in chunks, and an
  interrupted upload can continue.
- **The archives folder.** Copy the file into `/games/_archives/` (on the host, the `_archives`
  folder inside the folder you mounted at `/games`). It shows up in **Add games**. This is the
  better way for big files or a file already on the server.

Renplay does not install from a link. File hosts tie a direct link to the browser that opened it,
and stores need your login, so the file has to come from you.

Add games lists every download with what Renplay found: the game, its engine and whether the
[catalog](/catalog/) knows it. A download that cannot be installed shows the reason, for example an
engine that does not run in a browser.

## What happens during an install

Press **Install**. A background job runs, and **Settings** → **Activity** shows its log.

1. Renplay reads the archive in place, without unpacking it to disk, and finds the game and its
   Ren’Py version.
2. It matches the catalog by checksum, file name and size, or a pattern. A recipe can pick the
   engine, files to keep or leave out, and small patches.
3. It picks the engine and downloads it on the first install (about 16 MB), checking its checksum.
4. It splits Ren’Py’s `.rpa` archives and converts PNG and JPEG images to WebP under the same
   names. The game’s code is never run.
5. Files the game streams (images, audio, video) go into one `assets.pack`; what the engine needs
   at the start goes into `game.zip`.
6. The finished build appears at once. Installed builds never change; an update makes a new one.
7. Downloads uploaded through Renplay are deleted, unless `RENPLAY_DELETE_ARCHIVES=false`.
   Files you copied into the archives folder are never automatically deleted. A failed install
   keeps its download either way.

A big game takes minutes, mostly for image conversion. You can leave the page.

## After an install

- **Uninstall** removes the build. **Saves stay.** So do your mods, the library entry and
  favourites.
- **Reinstall** from the kept archive makes a fresh build, and saves stay.
- **Updates.** When the catalog lists a newer tested release than the one you have, Renplay says
  so. Download the new file and add it the same way.
- **Mods.** Open a game’s files to edit scripts in the browser or upload a mod. Your changes live
  next to the game, not inside it, and survive updates.

## Several games and sequels

Sequels find the previous season’s saves, as on the desktop. Copy saves between games from the
saves view when a game keeps them in a different folder.
