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
| Volume | a folder for data at `/data` |
| User | `1000:1000`, or any user that owns both folders |

That is the same as [Docker and Docker Compose](/install/docker/). Portainer and Dockge can use
that Compose file as it is.

Want a package for your platform? Say so in
[Discussions](https://renplay.org/discussions).
