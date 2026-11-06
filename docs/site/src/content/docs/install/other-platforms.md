---
title: Other platforms
description: Umbrel, CasaOS, Portainer and anything else that runs a container.
---

:::note[Status: coming]
Renplay has no package for a home server store such as Umbrel or CasaOS yet.
:::

Anything that runs a container can run Renplay. You need:

| Setting | Value |
|---|---|
| Image | `ghcr.io/renplay-org/renplay:<version>` or `renplay/renplay:<version>` |
| Port | `8080` |
| Volume | a folder for games at `/games` |
| Volume | a folder on local disk for data at `/data` (SQLite must not be on a network share) |
| Optional volume | Downloads and drop folder at `/downloads`, otherwise `/games/_archives` is used |
| User | `1000:1000`, or any user that owns the mounted folders |

That is the same as [Docker and Docker Compose](/install/docker/). Portainer and Dockge can use
that Compose file as it is. `/games` holds installed games, engines and scratch space.
Deleting `/data` loses saves. Deleting `/games` also loses downloads stored inside it. Rebuilding
games requires the original downloads. Downloads are kept by default. Settings controls cleanup
of uploads through Renplay. Files copied in are never deleted automatically. See
[storage folders](/install/docker/#storage-folders) for details.

Want a package for your platform? Say so in
[Discussions](https://renplay.org/discussions).

The image names, ports, paths and upgrade promise are covered by the
[3.x stability contract](/stability/).
