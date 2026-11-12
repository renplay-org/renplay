# Changelog

All notable changes to Renplay. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versions follow [Semantic Versioning](https://semver.org/): a minor version adds features, a
patch version fixes things, and a major version needs something from you when you upgrade (the
release notes say what).

## [Unreleased]

### Added

- Renplay keeps a copy of its library database before changing it and alongside the daily save backup.

### Fixed

- Games made with Ren'Py 7.5 to 7.8 show their Ren'Py version and get the right engine.
- Installing a game that kept the save folder of a Ren'Py sample project no longer replaces another game with that folder.
- Games made on Windows that ask for a file in another case (data/Items.json for data/items.json) find it.
- Games made with Ren'Py 6 that use its old themes show their frames and buttons.

## [4.10.0] - 2026-11-11

### Added

- The Library's heading says how many games you see, "All games 84" or "All games 12 of 84" while you search or filter. While the search is stuck under the header, and the heading is out of sight, the search says it at its right end. Screen readers hear the count when you pause, not on every key.
- **Clear filters** is the first chip of the row of tags while a tag or a list is on. It takes away the tags and the list and leaves your search, which has its own clear button.
- Press **/** outside a field to go to the search, as with Ctrl+K or ⌘K. On a phone, the keyboard's Search key closes the keyboard so the results show.
- The tag chips say how many of the games shown have each tag, and a tag with none is dim. The chips keep their order while you type, with the chosen ones first. In the Library you can choose more than one tag, and a game must have all of them.

### Changed

- Search finds more and puts the best first. While you type, the list is in best match order (the order control says so, and you can still pick another), and clearing the search brings back the order you chose. Words can come in any order, accents do not matter, and one wrong, missing, extra or swapped letter is forgiven in words of four letters or more. The letters that matched are marked in the titles. A tag matches only as a whole word or from its first three letters, so "ro" no longer brings every Romance game. The search says what it searches: title, developer or tag.
- Typing in the search no longer makes the page jump. The Library's shelves leave and return above the view while the search stays where it is, the page scrolls smoothly to put the search under the header when you start, and takes you back there when you have scrolled away and type another letter or change a tag or a list (at once with reduced motion), the list changes at the first key instead of after a pause, and an empty result keeps the page's height. Tiles stay calm while you type: the ones that stay on screen do not blink, a tile that comes back shows its picture at once, and the tile under a resting pointer does not lift as the list moves. While the search stays under the header it shares a see-through bar with the header, and the rows above it are out of sight, so nothing from the page reads through the header or between its controls.
- The flight from a tile to a game's page lands without a flicker.
- In the Library, **All tags** opens every tag with its count, as it does in the Catalog, instead of unfolding the row of chips.
- Ctrl+K and ⌘K no longer scroll the page smoothly past the search and back.
- The Up next carousel goes round. After the last game it shows the first, and before the first it shows the last, moving the same way as any other turn, whether it turns by itself or you use the arrows, the keys or a swipe. The dots still go straight to their game.

### Fixed

- The daily usage report is no longer refused when a catalog game's release name has a space or a bracket, or is empty. The collector now drops a release it cannot read and keeps the rest of the report. No upgrade is needed.
- Screen readers wait until you pause typing before announcing the search count, even when the latest letter finds the same number of games.
- The website's catalog fills the next rows before they come into view on a slow phone, so the request section and footer do not jump down while you scroll.
- The focus ring of the search was cut off on its left side in the Library on a computer and on its right side in the Catalog on a phone.
- The Catalog's tag chips no longer vanish while you search, and its All segment keeps its width.
- A search no longer adds a scroll position to the browser's memory for every word you try.
- The Library's heading keeps its height on phones with a wide font. The count that a search adds no longer wraps the heading onto a second line, and the link beside it is cut short instead. The footer's links are at least 40 px wide to touch.

## [4.9.0] - 2026-11-10

### Added

- Activity lets an admin move a waiting job up or down, put it first with **Do next**, and pause a waiting or running job. A paused job waits in the queue until you resume it, and says what resuming does: an install starts again from its archive. The order and the paused jobs are kept when Renplay restarts.
- The Library's top is one **Up next** carousel of the games you are playing, up to eight. Swipe or scroll it sideways, use the arrows on a computer, the dots under it or the arrow keys. It moves on by itself every few seconds, waits while a finger, the mouse or the keyboard is on it, and stays where you leave it once you have moved it. With reduced motion it does not move by itself.
- The website has a page for each safe-for-work game in the catalog, with its cover, where to get it and how to play it in Renplay.
- The whole catalog, adult games included, is at adult.renplay.org, behind a question about your age, with adult covers blurred until you show them. The catalog at renplay.org lists only safe-for-work games.
- The catalog on the website scrolls on as you near the end, and takes you back to the same place when you return from a game.
- A game's cover now flies back to its tile when you go back from a game page, with the back button, the browser's back or a swipe. The flight works on phones too, and is skipped when the tile is off screen.
- The Library and the Catalog grow as you scroll, in whole rows, so no row is half full in the middle of the list. Coming back from a game puts you at the same place with the same games loaded.
- The Catalog's search, filter and tags are in the address, and a game opened in the Catalog is a page in your history: the back button closes it.

### Changed

- Activity and the header's activity ring name a job by its game's title, from the library or from the catalog recipe the download matched. The file name shows only when no game is known.
- The Library and the Catalog have one search each, a pill the height of the controls beside it that narrows the list as you type. Ctrl+K or ⌘K goes to it on a computer. The search in the header and its menu of pages are gone, since the pages are one tap away in the header and the tab bar. A search that finds nothing in your library offers the Catalog.
- The demo has adult games turned off, and its banner says so.
- The docs and the website no longer shift while they load, and their buttons and links are at least 40 px tall on a phone. A check in CI keeps it so.
- Every tile is the game's vertical cover, including the Up next shelf, and the picture that flies from a tile to the game page always keeps that shape. When the catalog has a vertical picture for a game, it is used even if its default is another shape.
- Pages fade in instead of rising a few pixels, and the Library shows a loading page in the shape of the real one, so nothing jumps when the games arrive.
- The game page does not draw the title a third time: when the cover or the banner already shows it, the logo stays out.
- The phone tab bar is solid with a hairline on top, the loading line of the player is on a darkened strip, and the tip about the home screen shows once, after the game has started.
- The All, Installed and Not installed picker is gone from the Library. Not installed games are in All games as before, dimmed and marked. A shelf's See all link shows its list as a chip you can take off.
- The catalog tiles no longer say Free, since nearly every game is. The Free filter stays.

### Fixed

- Activity no longer counts a mod added, a mod removed and a mod build of one game as attempts. Only a job you retried counts, and the tag shows only from the second attempt.
- Links, chips, switches and the buttons of the game page are at least 40 pixels tall on a phone, and the page can be pinch zoomed.
- Screen readers hear the visible text first in the name of the tag chips, the sort button and the search button, and the sign-in page has a main region.
- A page opened in a tab that already had another page no longer takes that page's remembered place.

## [4.8.0] - 2026-11-10

### Added

- Renplay sends an anonymous usage report once a day: counts of its setup, size and use, and how catalog games install and play, by their catalog id. It never holds people, the titles of your own games, files or saves. An admin turns it off in Settings under About, or you set `RENPLAY_TELEMETRY=off`. The Telemetry page of the docs says what it holds.

## [4.7.0] - 2026-11-10

### Added

- Renplay can use a public Ren'Py pre-release engine, but only for a game made with a newer Ren'Py than every stable engine, such as Innocent Witches 0.11.7 (Ren'Py 8.6.0). Every other game keeps the newest stable engine, and an engine named in a recipe or setting is used as it is.

### Fixed

- Games made with Ren'Py 7 that import `__builtin__`, Python 2's name for the built-ins, start instead of failing at that import, as A House in the Rift did.

## [4.6.3] - 2026-11-09

### Changed

- A game whose newest release is marked as not working is no longer listed in the catalog, in Add games or on the website's catalog page. Renplay still recognizes its download and says it does not work.

### Fixed

- Games that use `requests`, such as ones with a news feed or an update check, start on the web instead of failing with a missing `js` module.
- A download that holds the developer's small launcher project next to the game, as Innocent Witches does, installs the game. Before, Renplay took the launcher and the game failed to start.

## [4.6.2] - 2026-11-09

### Added

- The Helm chart is listed on Artifact Hub.

## [4.6.1] - 2026-11-09

### Changed

- On a computer, every icon button names itself when you point at it, as most already did.
- The Library button on an empty Play history looks like the other buttons.

### Fixed

- A game kept offline opens with a network without checking every one of its files first. Since 4.6.0 it did each time, which slowed the start of a game with many files. Now it does only when the game's page changed, as after an upgrade.

## [4.6.0] - 2026-11-09

### Changed

- On a phone, Settings, Play history, Activity and Import saves have a Back button, like a game's page. Import saves goes back to where you came from instead of always to Settings.

### Fixed

- On a browser set to hide adult games, Import saves leaves out those games' saves, as its list of what it will import already did. Before, it imported them.
- `PORT` works in the image: nginx forwards to the port it names. Before, the server moved and every request failed.
- `RENPLAY_LOG_LEVEL` is read the same way for the server and for the requests nginx logs, in any case and with spaces around it.
- When Renplay starts and a game's files are missing, as when a network share is mounted late, the game shows as not installed and comes back by itself on a later start once the files are there. Before, it stayed not installed until it was installed again, and a share that could not be read at all made every game look missing.
- What an admin's import of a person's saves replaced is kept in History for at least 30 days, like what any other import replaces.
- A Ren'Py download installed over an HTML game of the same name now plays as a Ren'Py game.
- A game kept offline still plays offline after Renplay is upgraded. Playing it once with a network keeps the new files its page needs, and the compiled scripts it stored while playing.
- Offline, the pictures of adult games show as the person's level says. They were always blurred without a network.
- Removing unused engines keeps the engine of a game whose files are missing, so it plays when they come back, and waits while a job runs instead of removing the engine an install is building with.
- A mod uploaded as a zip may hold files of up to 256 MB and up to 10,000 files. It was held to the limits of a zip of saves (64 MB a file, 128 MB in all), whatever the upload allowed.
- The nginx and Kubernetes examples allow the 600 MB bodies Renplay takes. Behind them, uploads of mods, walkthroughs and zips of saves over 40 MB failed, and behind the Kubernetes example any upload over 1 MB did.
- On a phone, tapping a text field no longer zooms the page in, and Renplay does not zoom with a double tap or a pinch.
- In the player, Escape on the question about saves that have not reached the server closes only the question, not the player menu behind it. The notice that you were signed out takes the keyboard's focus, and Tab stays in it.
- A game's sheet in the catalog has a close button. On a phone it covered the page with no way to close it but the strip above it.
- A game without a developer no longer shows a dot before its version on its page.
- The footer on a phone no longer ends a line with a dot.
- The Users page names each person's username instead of starting a line with it.
- Import saves from a computer shows how far it is. Its progress bar was full as soon as it started.
- Download log in the player's options says when the game has not written a log yet, instead of doing nothing.

### Removed

- Libraries from before 4.0 no longer open in this version: start Renplay 4.5.1 on one once, then this version. Going back from 4.x to 3.x is no longer possible.
- `SAVES_DIR` and `SAVE_HISTORY_DIR`. Since 3.0 saves live under `/data/users/<id>/`, and these only placed links at the old folders for going back to 2.11.
- The API's `PUT /api/games/<id>/finished`. Set the status `finished` with `PUT /api/games/<id>/status` instead.

## [4.5.1] - 2026-11-08

### Fixed

- The player shows **Syncing** only when saves take more than a few seconds to reach the server, instead of at every save. Saves waiting on the device while it is offline still show at once.

## [4.5.0] - 2026-11-08

### Fixed

- With a game kept offline, every page of the library opens without a network, also pages that were never opened before, and the offline copy of the library follows each new version of Renplay.
- Changing the mods of a game kept offline downloads only the game itself again, not all of its pictures and sounds.
- Seeking in a video of a game kept offline reads only the part it needs, so long videos no longer fill a phone's memory.
- Keeping the same game offline in two tabs at once no longer deletes the other tab's files. The second tab says the game is being kept elsewhere.

### Security

- After signing out, an answer that was still on its way can no longer put the previous person back into the library's offline copy.
- Pictures and recipe files a catalog points to are fetched only from the address Renplay checked. A name that answers with a public address first and a local one a moment later can no longer make the server reach into its own network.
- Game pages play only inside Renplay's own player. Another site can no longer show them in a frame to trick people into clicking. The library itself can still be embedded, in a dashboard for example.

## [4.4.0] - 2026-11-08

### Added

- Ready-to-copy files for running Renplay in the repository's `deploy` folder: Docker Compose, Compose with Caddy for HTTPS, an nginx site, Helm chart values and bjw-s app-template values. The docs show the same files, and every release pins them to its version.
- `RENPLAY_DEMO=on` runs Renplay as a public demo. The sign-in page offers **Try the demo**, a shared guest who can play, save, rate and keep games offline, but cannot upload, install, change the account or see Settings, and no other sign-in works. Its saves are limited, so nobody can fill the demo's disk. A banner says it is a demo. The server stops after 4 hours of running, once idle for a minute, so a host that starts it again from its image starts it fresh.

### Changed

- The `edge` image is no longer built from every change. The Renplay Team builds one when a change needs trying on a server. Use a released version.

### Fixed

- **Refresh** on the Catalog page shows only to admins, who are the only ones it works for.
- The library no longer shows **Added this week** above **All games** when the two hold the same games.

### Security

- An HTML game sends its messages to the player only on Renplay's own address, so another site that embeds the game cannot read them.
- Sync codes use each of their 36 characters equally often.
- The server's dependencies are updated with their security fixes: proxy-addr (under Express), multer, body-parser, qs and others.

## [4.3.1] - 2026-11-08

The docs describe Renplay 4.0 to 4.3, with new screenshots, and **Import from a computer** is on
every person's Account page.

### Changed

- **Import from a computer** is on every person's **Account** page, next to **Export all my saves**. It was only in the admin's **Settings**.
- The docs cover Renplay 4.0 to 4.3: offline play, controllers, Who is playing, Defaults for everyone, Your recipes, the adult games choice, the player's new controls and a new **Dashboards** page for Prometheus and Homepage.

## [4.3.0] - 2026-11-08

Renplay 4.3 is a polish release. The player loads with one honest progress bar and lets you mute,
go full screen or leave while it does. Pages no longer jump while they load, opening a game starts
at its top, and Resume is on the first screen of a phone. Adult games are one choice on your
account. Mods and files is rebuilt, and menus have their blur back in Chrome. Nothing needs
changing to upgrade. Every game's art is made again once, in the background.

### Changed

- The account menu is a small menu under your picture instead of a window in the middle of the screen, with the admin's pages apart from your own.
- **Main menu** is gone from the game page: **Resume** or **Play** starts the game, and its own menu is a tap away. In the player's drawer it is now **Save and go to the main menu**.
- **All tags** (and **Clear tags**) sit at the right end of the tag row in the library and the catalog. On a phone, rows that scroll sideways fade at their right edge.
- Activity uses the page's whole width, and Settings and Import saves sit in a centred column.
- The game page's title in the browser tab is the game's name.
- The loading screen has **Game page**, **Sound** and **Full screen**, so you can leave, mute or go full screen before the game starts. Its progress is one bar that only goes up, from the engine to the game's first screen.
- **Full screen** sits beside the **Renplay** pill over the game, and the drawer has **Sound** and **Full screen** at its top. The pill is lit for the first seconds of a game, then quiet.
- A game's page opens at its top, at once and without a spinner, and its picture flies from the tile to the poster. **Back** returns to where you were in the library. On a phone the page rises in without the flight.
- On phones, **Resume** and **Play** come right under a game's title, before its tags and summary, so they are on the first screen in portrait and landscape. Held sideways, the stage is shorter. The bar with **Resume** at the bottom appears as soon as the button is behind the tab bar.
- The library's stage on a phone shows where you are in two short lines, and **Not now** sits centred under the two buttons.
- **Adult games** on your account is one choice: Off, Blurred or Shown. Levels above your limit cannot be chosen, and one line says who sets that limit: the installation, an admin or a sign-in group. The admin's limit for everyone is **Highest level for everyone** in **Settings**, and each person's in **Users**.
- Showing less in one browser, for a shared screen, is in **Settings → This browser**, and **Hide adult games here** in the account menu does it in one tap. Your account page says when this browser shows less, with **Follow my choice here**.
- **Mods and files** (the game page tab that was **Mods and options**) starts with what your mods change and **Install mod zip**, **Apply changes** and **Remove all mods**, then the game's files with rows a finger can hit, a **+** for a new file or an upload, and long folders shown 200 at a time.
- The library's **Added this week** shelf shows only while most of the library is not new, and an install that cannot finish can be dismissed from the library. The tile of the game on the stage is lit in its own colour: the white ring is for keyboard focus only.
- **Fit** shows the game in its own shape with the player's bars around it, and **Fill** crops only the sides, never the top or bottom where games keep their dialogue.

### Fixed

- Menus, sheets and the tab bar had no blur behind them in Chrome, Edge and other Chromium browsers, so text behind them showed through. The build dropped the property those browsers read.
- Pages no longer jump while they load: the footer, a game's logo and the Add games page held their place.
- **Resume** and **Play** show the focus ring when reached with the keyboard.
- A picture is never cut and stretched to more than about twice its size for a game's art: a small store header no longer becomes a blurry background, and the soft background made instead is a smooth glow of the game's colours. Every game's art is made again once after the upgrade.
- A game with saves but under a minute of play time said "Not played yet". It now says "Under a minute played".

## [4.2.0] - 2026-11-07

Renplay 4.2 plays Ren’Py games with no network and with a controller. Keep a game offline from its
page, and it plays from that browser, with saves sent when the network is back. A controller moves
around the library, plays the game through Ren’Py’s own buttons, and opens the player's drawer with
its Menu button. Nothing needs changing to upgrade.

### Added

- **Keep offline** on a Ren’Py game's page keeps the game in that browser, so it plays with no network. Saves made offline wait on the device and are sent when the network is back, with the usual rule when another device saved too. The library opens offline and says so. On iPhone and iPad this works from Renplay on the Home Screen, because Safari clears what a tab keeps after a week.
- Controllers: the d-pad or left stick moves around Renplay, A presses and B closes sheets and menus. In a game the controller plays through Ren’Py’s own buttons, and the Menu button opens the player's drawer (Ren’Py's game menu stays on B).

### Changed

- Arrow keys at the edge of the library's rows and grids now scroll the page instead of doing nothing, and up from the buttons above the tiles no longer jumps down into them.

## [4.1.0] - 2026-11-07

Renplay 4.1 lets you keep recipes of your own, filter the catalog by tags you include or leave out,
switch people on a shared device with a PIN, set defaults for everyone, see what uses space, and
connect a dashboard. Settings now says where each value comes from. Nothing needs changing: the
database updates itself on the first start.

### Added

- **Your recipes:** recipe files in a folder on your server (`/data/recipes`, or `RENPLAY_RECIPES_DIR`) are read as one more catalog, in the catalog's own format. A recipe there takes the place of the catalog's recipe with the same id, so you can fix a game or add one without waiting for the catalog. Art and patches can be files in the folder. A recipe without an `nsfw` line counts as an adult game. **Settings** lists each source with its recipes and any problems.
- Tags on the Catalog page can be included or left out: a tap includes a tag, the next leaves it out, the next clears it. **All tags** lists every tag by group, with how many games have it. Your choices are kept with your account.
- **Show what uses space** in **Settings → Storage** lists each game with its build, other builds and download, largest first, the engines, and folders in the games folder that belong to no game. It says how much can be freed, and deletes a download or unused engines from there.
- **Defaults for everyone** in **Settings**: tags left out on the Catalog page, Lighter background, the text size in games, and Rollback and Skip. People start with these until they choose their own, and the player's Options say when a value is the admin's default.
- **Who is playing?** in the account menu switches a shared device to another person with their PIN, without their password. Each person sets a PIN of 4 to 8 digits in **Account**. Only people who signed in on that browser before appear, admins always use their full sign-in, and five wrong PINs lock switching to that person for 15 minutes. Signing out everywhere or changing your password removes your PIN.
- Dashboards: `/metrics` gives Prometheus counts about the server, for admins, and `/api/widget` gives JSON for Homepage's custom API widget: the library's size, installs running, and what you played last and today. Both take an access token from **Account → Access tokens**.
- The art picker lists your uploads with **Delete**. Each person keeps up to ten pictures of each kind per game.

### Changed

- **Settings** says where each value comes from: the default, a choice made here, or a variable set on the server (the folders, sign-in, backups, the catalog and Your recipes, Keep downloads, Sync codes).
- **Choose artwork** opens only for the person who started the install.
- Sync codes write save times in your own time zone, so desktop Ren’Py sorts the saves correctly.
- Art and recipe patches are downloaded only from the public internet, or from the catalog's own server, so a catalog cannot make Renplay reach into your local network.

### Fixed

- On the **Account** page the rows of **Adult games** that cannot be changed lay over the others, so a tap on **You** could miss.
- After an upload's answer was lost on a bad connection, the next save could show that another device had saved too.
- Removing a person or forgetting a game left their art choices and uploads behind.

## [4.0.1] - 2026-11-07

The server log is easier to read, and `RENPLAY_LOG_LEVEL` chooses how much it says.

### Changed

- The server log is easier to read. Every line has the date and time, the level, where it comes from and what happened, in the same columns for Renplay and its web server. The start lists the version, the library, sign-in, the adult games level, the catalog, save backups and the folders, and installs, catalog updates, backups and sign-ins each get a line. Requests show the visitor's address instead of the proxy's.
- `RENPLAY_LOG_LEVEL` chooses how much is logged: `error`, `warn`, `info` (the default, which leaves out plain page and data reads) or `debug` (every request, and each install as it runs).

### Fixed

- The log no longer starts with "Failed to connect" lines while the server comes up.

## [4.0.0] - 2026-11-07

Renplay 4.0 is a new look, Lantern, with three levels for adult games, art for every game, a
player without a toolbar and saves that move safely between devices. **Before you upgrade:** back
up `/data` as usual. Nothing needs changing. On its first start 4.0 updates the database, and 3.2.0
still runs on it if you go back. Each person's 3.x picture preference becomes their own level for
adult games: Show becomes Shown, Hide adult games becomes Off, and Hide pictures or no preference
becomes Blurred. Someone who never chose sees adult games without their pictures until they choose
Shown under **Account → Adult games**. Daily save backups start in `/data/backups/saves`.

### Added

- A new look, Lantern: a dark room lit by the game you are looking at. Games are posters in the library, the game page opens on the game's own art with its logo, and the picture travels from the tile to the page.
- Games have art in five formats, the shapes SteamGridDB uses: a 600 × 900 poster, a wide banner, a hero for the top of the game page, a logo and an icon. Pictures come from the catalog (Steam, itch.io, SteamGridDB credited to their author, the developer). Renplay keeps them in its data folder and makes any missing format from the others, without adding text. The game page says where its art came from, and pictures show their colours the moment a page opens.
- **Change art** on a game's page, or **Details → Art**, opens the art picker: every picture is shown as it will look in place, and a tap chooses it. Your choice changes only what you see, an admin can choose for everyone, and **Use the default** goes back. Upload your own picture too, cropped around the point you tap.
- After an install finishes, **Choose artwork** opens once with the catalog's pictures picked, so one tap on **Keep this art** keeps them.
- Each game has a status for you, Playing, Stalled, Dropped or Finished, and a rating from one to five stars. Stalled, Dropped and Finished leave Up next, and the library sorts by Rating and Time played.
- **Not now** on the library home takes a game out of Up next until you play it again.
- **Play history** shows your time day by day and per game, and a game's page shows its last sessions.
- The player's menu: a quiet **Renplay** pill at the top left opens Saves, Guide and Options, **Save now** and **Save and exit**. A swipe from the left edge opens it too.
- Walkthroughs open in a window beside the game that you can move, resize and see through, or in a reading sheet on a phone held upright. A game can keep several walkthroughs, as PDFs, pictures or text files.
- The player's **Options** set the text size (Normal, Large, Larger), open Ren'Py's own accessibility menu where the game offers it, and for you alone turn on **Rollback**, **Skip** and the **Developer console** where a game turns them off. They follow you to every device with the game's saves.
- Saves can have your own name and a note, and a **pinned** save keeps every previous version. Only you see them, and the save file itself never changes.
- **Import from a computer** (in **Settings**) brings in the saves from desktop Ren’Py. It shows where Ren’Py keeps saves on your system, reads the folder or a zip of it in the browser, and previews every game's saves as new, newer or older before anything is written.
- **Sync codes**, once an admin turns them on in **Settings**: a game's **Saves** can make a code for Ren’Py's own Download Sync on a computer or Android phone, or bring in the saves from a code made with Upload Sync there. Saves travel encrypted through Ren’Py's sync server and leave your server only when someone asks for a code. Games made with Ren’Py 8.1 or newer have Sync.
- Renplay backs up everyone's saves once a day as a zip, keeping the newest 14, in `/data/backups/saves` or the folder set by `RENPLAY_BACKUP_DIR`. **Settings** lists them for download and has **Back up now**.
- **Lighter background** under This browser in **Settings** shows a plain background instead of the game's art. Until you choose, it follows the device's reduced motion and data saver settings.
- A game's page says how it plays on phones (Great on phones, Playable on phones, Needs a bigger screen) when its recipe says so.

### Changed

- Adult games have three levels, Off, Blurred and Shown, in place of the four 3.x controls. Off leaves adult games out of everything, Blurred shows them without their pictures, Shown shows everything. The installation, each account, each person and each device can only go lower than the layer above. **Account → Adult games** shows all four and says why you see what you see.
- Blurred is enforced by the server: it never sends a picture of an adult game to a person below Shown, and an installation at Blurred never downloads one. Save pictures of adult games show only a soft blur of their colours.
- `RENPLAY_ADULT_GAMES` and `RENPLAY_ADULT_DEFAULT` take `off`, `blurred` or `shown`. The 3.x values still work, `allow` as Shown and `block` as Off. Sign-in groups set levels with `RENPLAY_OIDC_ADULT_GROUPS` and `RENPLAY_LDAP_ADULT_GROUPS`, for example `renplay-adults=shown,renplay-family=blurred`. The 3.x single group variables still work.
- When two devices change the same save, the copy saved later stays in the slot and the other is kept in History. Before, the last upload always won. The player and the game's saves tell you when this happens.
- **Save and exit** makes an autosave first, or a quick save in games without autosave, and waits until it reaches the server. When saves cannot get there it asks before leaving: they stay on the device and go up the next time the game opens there. **Main menu** saves first too.
- The player has no toolbar any more, and the game fills the screen.
- The catalog is read from `index.v4.json`. A catalog in the older format still works, its cover becoming the poster.
- The Catalog has its own page, and Activity is always one tap away in the header. A game's page has its sections in one row: Play, Saves, Walkthroughs, Mods and options, Details and Manage.
- Every button and link has a 44 px touch area, and the layout fits phones from 390 px wide in portrait and landscape.
- Play time stops counting after 15 minutes without a tap, click or key, and History groups your play by your own days.
- The reminder that sign-in is off is one sentence in Settings instead of a banner on every page.

### Fixed

- Uploading mod files into the top of the game folder failed with “Only files inside game/ can be modded”.
- Two open windows of a game counted play time twice.
- Several messages at once covered each other. They now stack.
- On iPhone and iPad a PDF walkthrough showed only its first page. It now opens in its own tab.

## [3.2.0] - 2026-11-06

### Added

- Optional `/downloads` storage separates downloads from installed games. Without it, Renplay keeps using `/games/_archives`. Existing files are never moved, and Settings shows the folder in use.
- Downloads are kept by default. Admins can change **Keep downloads** in Settings, or operators can lock the choice with `RENPLAY_KEEP_DOWNLOADS`. Turning it off deletes only unchanged uploads through Renplay after a successful install. The old `RENPLAY_DELETE_ARCHIVES` variable remains a deprecated inverse alias.
- Game details show whether a download is kept. Admins can delete it to free space without touching installed games or saves. Reinstalling then needs the download again.
- An official Helm chart supports persistent storage, NFS for games and downloads, Ingress, Gateway API routes and existing sign-in secrets. Releases publish a signed OCI chart to GHCR.

## [3.1.0] - 2026-11-05

### Added

- Single sign-on with OpenID Connect (Pocket ID, Authentik, Authelia, Keycloak and others): set
  `RENPLAY_OIDC_ISSUER`, the client ID and secret. People are created at their first sign-in
  unless `RENPLAY_OIDC_AUTO_CREATE=false`. A group can make people admins
  (`RENPLAY_OIDC_ADMIN_GROUP`) or give them adult games (`RENPLAY_OIDC_ADULT_GROUP`), checked at
  every sign-in.
- Sign-in with an LDAP directory such as LLDAP, with filters for admins and adult games, StartTLS
  or LDAPS.
- Link and unlink your sign-in methods on the Account page. You always keep at least one way in,
  and `RENPLAY_AUTH_LOCAL=false` hides the password form when single sign-on is set up.
- Avatars: upload one, or Renplay copies the picture from your sign-in provider. Everyone else
  sees your initials.
- Search everything from one place: press ⌘K on a Mac or Ctrl+K elsewhere, or the search button
  on phones. It finds games in your library and the catalog, pages and actions.
- An admin who signs in through a provider before the owner account is claimed can claim it from
  the Account page.

## [3.0.0] - 2026-11-05

Renplay 3.0 adds accounts. **Before you upgrade:** back up `/data`. On its first start 3.0 moves
saves into `/data/users/1/` and makes its own backup in `/data/backups/pre-3.0/`; 2.11 still runs
on the same data if you go back. Sign-in stays off until you set `RENPLAY_AUTH=on`; behind a
reverse proxy with HTTPS, also set `RENPLAY_PUBLIC_URL`. Nothing else needs changing.

### Added

- Single sign-on with OpenID Connect (including Pocket ID) and directory passwords through LDAP.
  Link sign-ins from Account without merging people or their saves. Groups can set admin roles
  and adult access automatically at sign-in.
- Profile pictures: crop and upload your own in Account, or copy your sign-in provider's picture.
  Pictures stay on your server and appear in the account menu, phone You tab and Users.
- Search games, the catalog, pages and actions from the header or phone search button. Use ⌘K
  on Apple devices or Ctrl+K elsewhere, then arrow keys and Enter or a tap to choose a result.
- Accounts. Turn on sign-in with `RENPLAY_AUTH=on` and everyone gets their own saves, save
  history, favourites, Finished stories and play time; the library is shared. A new install asks
  for a setup code from the server log before creating the owner account. Upgraded installs keep
  sign-in off, with a reminder for admins, and every existing save stays with the owner.
- Admin and player roles. Players play; admins also install games, manage mods and users, and see
  Activity and the server settings. Game files, covers and walkthroughs need the same access as
  the library.
- An Account page: your name, password, adult pictures, where you are signed in, access tokens for
  scripts, and an export of all your saves.
- Users in Settings, for admins: add people, set their role and whether they may see adult games,
  disable accounts, reset passwords, and copy, merge, export or import saves between people.
  Anything a copy would overwrite is kept in the save history. These tools work with sign-in off
  too, to prepare a library before turning it on.
- Adult games per person: new people start without them unless the server sets
  `RENPLAY_ADULT_DEFAULT`. Everyone chooses Show, Hide pictures or Hide adult games, and a device
  can hide more than its account allows, never less.
- A game asks you to sign back in when your session ends, and keeps saves it has not sent yet for
  the account that made them.
- A stable installation contract for 3.x: image names, port, folders, configuration and upgrade
  promises are documented in the new Stability page. Container health checks now check the app
  through nginx.
- Containers support arbitrary non-root user IDs, including TrueNAS's 568:568, with a read-only
  root filesystem. Unraid-style `PUID` and `PGID` work when started as root; the app always drops
  to a non-root user before starting.

### Changed

- After installation, automatic archive cleanup deletes only downloads uploaded through Renplay.
  Files you copied into the archives folder, and older downloads whose origin is unknown, are
  never automatically deleted. `RENPLAY_DELETE_ARCHIVES=false` still keeps everything.
- Saves move to `/data/users/<id>/` on the first start. The upgrade backs up saves, save history
  and the library first (`/data/backups/pre-3.0/`), and leaves the old folders as links, so
  2.11 still runs on the same data if you go back.
- HTML games run fully isolated from Renplay, including any page they open, and passwords use
  stronger hashing.

## [2.11.1] - 2026-11-05

### Fixed

- A season or spin-off that shares its save folder with a game already in the library installs
  beside it instead of replacing it (Fresh Women Season 2 replaced Season 1). Saves were never
  touched.

## [2.11.0] - 2026-11-05

### Added

- Documentation at docs.renplay.org: installing on each platform, adding and playing games,
  every setting, upgrading and troubleshooting. The app links to the matching page from
  Settings, the empty library, Add games, Activity and the iPhone full-screen help.

### Changed

- The browser tab shows the game's title while you play.

### Fixed

- Installs use far less memory. Games with thousands of high-resolution images or large videos
  no longer run out of memory (Fresh Women Season 2 did at 4 GB). Unusually large images stay
  in their original format.
- Install logs survive a restart or crash, so an interrupted install still shows what happened.
  Clearing finished activity removes its logs too.

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

- The documentation has its own site, docs.renplay.org, with install guides, a configuration
  reference for every environment variable, upgrading, troubleshooting and a FAQ.
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

[Unreleased]: https://github.com/renplay-org/renplay/compare/v4.10.0...dev
[4.10.0]: https://github.com/renplay-org/renplay/compare/v4.9.0...v4.10.0
[4.9.0]: https://github.com/renplay-org/renplay/compare/v4.8.0...v4.9.0
[4.8.0]: https://github.com/renplay-org/renplay/compare/v4.7.0...v4.8.0
[4.7.0]: https://github.com/renplay-org/renplay/compare/v4.6.3...v4.7.0
[4.6.3]: https://github.com/renplay-org/renplay/compare/v4.6.2...v4.6.3
[4.6.2]: https://github.com/renplay-org/renplay/compare/v4.6.1...v4.6.2
[4.6.1]: https://github.com/renplay-org/renplay/compare/v4.6.0...v4.6.1
[4.6.0]: https://github.com/renplay-org/renplay/compare/v4.5.1...v4.6.0
[4.5.1]: https://github.com/renplay-org/renplay/compare/v4.5.0...v4.5.1
[4.5.0]: https://github.com/renplay-org/renplay/compare/v4.4.0...v4.5.0
[4.4.0]: https://github.com/renplay-org/renplay/compare/v4.3.1...v4.4.0
[4.3.1]: https://github.com/renplay-org/renplay/compare/v4.3.0...v4.3.1
[4.3.0]: https://github.com/renplay-org/renplay/compare/v4.2.0...v4.3.0
[4.2.0]: https://github.com/renplay-org/renplay/compare/v4.1.0...v4.2.0
[4.1.0]: https://github.com/renplay-org/renplay/compare/v4.0.1...v4.1.0
[4.0.1]: https://github.com/renplay-org/renplay/compare/v4.0.0...v4.0.1
[4.0.0]: https://github.com/renplay-org/renplay/compare/v3.2.0...v4.0.0
[3.2.0]: https://github.com/renplay-org/renplay/compare/v3.1.0...v3.2.0
[3.1.0]: https://github.com/renplay-org/renplay/compare/v3.0.0...v3.1.0
[3.0.0]: https://github.com/renplay-org/renplay/compare/v2.11.1...v3.0.0
[2.11.1]: https://github.com/renplay-org/renplay/compare/v2.11.0...v2.11.1
[2.11.0]: https://github.com/renplay-org/renplay/compare/v2.10.0...v2.11.0
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
