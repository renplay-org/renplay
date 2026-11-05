---
title: Unraid
description: Run Renplay on Unraid. A ready-made package is coming.
---

:::note[Status: coming]
There is no Renplay package for Unraid yet, and Renplay is not listed in the Unraid Community Applications store. This page
will link to it when it exists.
:::

## What works today

Unraid runs containers from its Docker tab, with host paths for the two folders. Renplay is a normal container, so you can run it there like any other:

1. Create two folders on a disk with room for games: one for games, one for data.
2. In Docker, create a container from the image `ghcr.io/renplay-org/renplay` (or
   `renplay/renplay` on Docker Hub). Pin a version tag.
3. Map port **8080** of the container to a port on the NAS.
4. Mount the games folder at `/games` and the data folder at `/data`.
5. Make both folders writable by the container's user. To use Unraid's 99:100, set the container
   user to `99:100`. Alternatively start as `0:0` with `PUID=99` and `PGID=100`; the entrypoint
   drops root before starting the app. Setting these variables alone does not override the image's
   default non-root 1000:1000 user. Renplay does not change your folders' ownership.

The names of the screens differ between versions of the system, so these steps stay general. The
settings are the same as in [Docker and Docker Compose](/install/docker/), which also lists the
options.

Keep `/data` on local disk and in your NAS backups; its SQLite database must not be on a
network share. `/games` and the archives folder can be shares. Put a sign-in in front of Renplay before you open it to the
internet: [Reverse proxy and HTTPS](/install/reverse-proxy/).

The image names, ports, paths and upgrade promise are covered by the
[3.x stability contract](/stability/).
