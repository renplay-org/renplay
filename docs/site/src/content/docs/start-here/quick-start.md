---
title: Quick start
description: Run Renplay, add a game and play it.
---

## Run it

Renplay is one container. Give it a folder for games and one for data:

```sh
docker run -d --name renplay -p 8080:8080 \
  -v /path/to/games:/games \
  -v /path/to/data:/data \
  ghcr.io/renplay-org/renplay:__RENPLAY_VERSION__
```

The image runs as user 1000, so that user must be able to write to both folders. For a long-lived
setup use [Docker Compose](/install/docker/). The image tag above pins this release, so upgrades
happen when you decide. The same image is on Docker Hub as `renplay/renplay`.

Open `http://localhost:8080`.

## Add a game

Copy a game’s PC download (zip, 7z or rar) into `/path/to/games/_archives/`, or upload it under
**Add games**. Press **Install**. The first install also downloads the Ren’Py web engine, about
16 MB. See [Adding games](/guides/adding-games/) for what happens next.

## Play

Open the game from the library and press **Play**. Saving works as in the desktop game, and the
save goes to your server at once.

## Play on your phone

Open Renplay in the phone’s browser and hold the phone sideways. On iPhone, add Renplay to the Home
Screen first. See [Playing](/guides/playing/).

## Before you share it

Keep `RENPLAY_AUTH=on` to separate people's saves. New installs ask for the setup code from
`docker logs renplay`; upgrades keep sign-in off until you enable it. See [Accounts](/accounts/)
and [Reverse proxy and HTTPS](/install/reverse-proxy/) before exposing it outside your network.
