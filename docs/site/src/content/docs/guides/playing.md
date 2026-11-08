---
title: Playing
description: Play on phones and computers, offline and with a controller, install the home-screen app, and move saves to and from desktop Ren’Py.
---

## Find a game

Open **Search** in the header (also available on phones), or press **⌘K** on Apple devices and
**Ctrl+K** elsewhere. Search titles, developers and tags across your library and the catalog,
open a page, or resume your Up next game. Use arrow keys and Enter or tap a result. Catalog
results show where to get the game. Only admins see Add games, Activity and Users.
Search follows your adult games level, as the library does.

## On a computer

Open the game and press **Resume** (or **Play** the first time). **Resume** opens your latest save,
and the game's own menu is a tap away for a new game or another save. **Up next** on the library
home resumes straight away.

While the game loads, one bar shows how far it is, from the engine to the game's first screen.
**Game page**, **Sound** and **Full screen** sit at the top, so you can leave, mute or go full
screen before it starts.

The game paces itself to your display. Two quiet things sit over it: the **Renplay** pill at the
top left and, beside it, **Full screen**. Both are lit for the first seconds of a game. The pill (or
**Esc**, or a swipe from the left edge on a phone) opens the player menu:

- **Sound**, **Full screen** and close at its top.
- **Saves** to load one, **Guide** for the game's walkthroughs, and **Options** for the display,
  the text size and Ren'Py's own accessibility menu.
- Under **For you in this game**, **Rollback**, **Skip** and the **Developer console** turn those
  on even where the game turns them off. They are kept with the game's saves, so they follow you
  to every device, and the game's files do not change. An admin can set Rollback, Skip and the text
  size for everyone who has not chosen ([Defaults for everyone](/accounts/#defaults-for-everyone)).
- **Save now** makes a quick save, **Save and exit** saves and goes back to the library, and
  **Save and go to the main menu** starts the game again at its main menu.

**Options → Scaling** decides how the game meets a screen of another shape. **Fit** shows the whole
game in its own shape with bars around it. **Fill** has no bars at the sides: it crops the edges of a
game wider than the screen, and never the top or bottom, where games keep their dialogue.

Walkthroughs open in a window beside the game that you can move, resize and see through, or below
it on a phone held upright.

## Up next, status and ratings

**Up next** holds the games you are playing, newest first. **Not now** takes a game out of it until
you play it again. On a game's page, under **Play**, set its **Status**: Playing, Stalled, Dropped
or Finished. Stalled, Dropped and Finished leave Up next, and your saves are kept. Rate a game with
up to five stars. The library can sort by **Rating** and **Time played**.

## History

**Account → Play history** shows how long you played, day by day, and the time per game with your
ratings and statuses. A game's page shows its last sessions. Renplay counts the time a game is open
and in front of you, and stops after 15 minutes without a tap, click or key. Each person has their
own history.

## On a phone

![The library on a phone](../../../assets/phone-library.webp)

Open Renplay in the phone’s browser. **Resume** and **Play** come right under a game's title, on the
first screen, held upright or sideways. Hold the phone sideways to play: the game fills the screen
around the camera cutout. Every screen works with touch only.

### iPhone and iPad: add it to the Home Screen

Safari cannot show a web page full screen, but a home-screen app can.

1. Open Renplay in Safari.
2. Tap **Share**, then **Add to Home Screen**.
3. Open Renplay from the new icon.

The player explains this itself where a fullscreen button would not work.

### Android

Use **Full screen** beside the **Renplay** pill.

Serve Renplay over HTTPS so the browser can cache the game and the home-screen app works. See
[Reverse proxy and HTTPS](/install/reverse-proxy/).

## Play offline

A Ren’Py game can be kept in a browser and played with no network: on a plane, on a train, or
wherever the server is out of reach.

1. Open the game's page while you have a network.
2. Under **Play**, choose **Keep offline**. The game downloads into this browser, with its engine
   and every file it streams. Keep the page open until it says **Kept in this browser**. A stopped
   download continues where it was.
3. With no network, open Renplay as usual. The library says it is offline, and kept games play.

Saves made offline wait on the device. The player says how many are waiting, and sends them when the
network is back, with the usual rule when another device saved too. **Update offline copy**
appears when the game gets a new version, and the old copy keeps playing until then. **Remove
offline copy** frees the space. Your saves are never part of it.

- **Room:** a game is often several gigabytes. Renplay checks there is room before it starts, and
  asks the browser to keep the data.
- **iPhone and iPad:** keep games from Renplay on the Home Screen, not a Safari tab: Safari clears
  what a tab keeps after a week without a visit.
- **Shared browsers:** a kept copy belongs to the browser. Offline, a game opens for whoever is
  signed in there, with their own saves, and only if they opened it online before.
- Renplay must be served over HTTPS (or on `localhost`) for a browser to keep games.

## With a controller

A controller works everywhere in Renplay. The d-pad or left stick moves between tiles and buttons,
**A** presses and **B** closes sheets and menus. In a game the controller plays through Ren’Py’s
own buttons: **A** advances and chooses, the d-pad moves through menus, the shoulder buttons roll
back and forward, and **B** opens the game's menu. The **Menu** button (Start) opens the player
menu instead, and closes it again.

## Saves and history

- Saves, autosaves and progress go to your server **as you make them**. Open the same game on
  another device and its saves are there.
- They are stored the way desktop Ren’Py stores them.
- **Every overwrite and delete keeps the earlier version.** `RENPLAY_SAVE_HISTORY` sets how many
  versions are kept per save file (20 by default). Look at them in the game’s saves view.
- Uninstalling or reinstalling a game never deletes saves.
- When two devices change the same save without seeing each other's copy, the copy saved later
  stays in the slot and the other is kept in History. The player and the game's saves both say so.
- Give a save your own name and a note, or **Pin** it, from its menu. A pinned save keeps every
  earlier version instead of the newest few. Only you see names, notes and pins, and the save file
  itself never changes.
- Admins also get a daily zip of everyone's saves. See [Backups](/upgrading/#daily-save-backups).

## Export to desktop Ren’Py, and import from it

Export a game’s saves from its page (**Export all** under **Saves**), or all of yours from
**Account** (**Export all my saves**). Put the files in the desktop
game’s save folder and it loads them.

To bring saves the other way, open **Account** on the computer where you played and choose
**Import from a computer** (admins also find it in **Settings**). Renplay shows where Ren’Py keeps saves on that system
(`~/Library/RenPy` on a Mac, `%APPDATA%\RenPy` on Windows, `~/.renpy` on Linux). Choose that
folder, or a zip of it, and a preview lists each game's saves as new, newer or older than the
server's copy before anything is written. Older copies never replace newer ones: they are kept in
History. Saves for games you have not added yet wait on the server until you add them. To import
saves for one game only, use **Import** under the game's **Saves**.

### Sync codes

Games made with Ren’Py 8.1 or newer have **Upload Sync** and **Download Sync** on their save and
load screens. Renplay speaks the same codes, once an admin turns on **Sync codes** in
**Settings**. Under the game's **Saves**, **Sync code** makes a code from your saves to type into
Download Sync on a computer or Android phone, or brings in the saves from a code that Upload Sync
made there. The saves travel encrypted through Ren’Py’s sync server, which keeps them for an hour,
and they leave your server only when you ask for a code. Saves brought in follow the rule for two
devices: the newer copy stays in the slot and the other is kept in History.

## Walkthroughs and play time

A game can keep several walkthroughs: PDFs, pictures and text files. Admins add them under
**Walkthroughs** on the game's page, and rename, reorder or remove them from each one's **More**
menu. Everyone who plays the game can open them. Renplay counts the time a game is open and
visible, and shows it with your latest save. Time is counted from the moment you upgraded to a
version that counts it.
