---
title: TrueNAS
description: Run Renplay on TrueNAS. A ready-made package is coming.
---

:::note[Status: coming]
There is no Renplay package for TrueNAS yet, and Renplay is not listed in TrueNAS apps. This page
will link to it when it exists.
:::

## What works today

TrueNAS SCALE and Community editions run containers as Apps. Datasets give you the two folders. Renplay is a normal container, so you can run it there like any other:

1. Create two folders on a disk with room for games: one for games, one for data.
2. In Apps, create a container from the image `ghcr.io/renplay-org/renplay` (or
   `renplay/renplay` on Docker Hub). Pin a version tag.
3. Map port **8080** of the container to a port on the NAS.
4. Mount the games folder at `/games` and the data folder at `/data`.
5. Make both folders writable by the container's user. The default is 1000:1000; TrueNAS's
   568:568 works too. Set the container's user and group to match the dataset permissions.

The names of the screens differ between versions of the system, so these steps stay general. The
settings are the same as in [Docker and Docker Compose](/install/docker/), which also lists the
options.

Keep `/data` on local disk and in your NAS backups. Its SQLite database must not be on a
network share. `/games` holds installed games, engines and scratch space. Optionally mount a
separate downloads share at `/downloads`. Without it, downloads stay in `/games/_archives`.
Deleting `/data` loses saves. Deleting `/games` also loses downloads stored inside it. Games can
be rebuilt only while their downloads are kept. Downloads are kept by default, and Settings
controls cleanup of uploads through Renplay. Files copied in are never deleted automatically.
See [storage folders](/install/docker/#storage-folders) for the full layout. Put a sign-in in front of Renplay before you open it to the
internet: [Reverse proxy and HTTPS](/install/reverse-proxy/).

The image names, ports, paths and upgrade promise are covered by the
[3.x stability contract](/stability/).
