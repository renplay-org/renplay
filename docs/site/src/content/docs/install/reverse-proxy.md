---
title: Reverse proxy and HTTPS
description: Put Renplay behind a reverse proxy, with sign-in and HTTPS.
---

Renplay has **no user accounts**. Anyone who can open it can play, delete saves and install games.
If it is reachable from outside your network, put your own sign-in in front of it: a reverse proxy
with authentication, or a VPN such as WireGuard or Tailscale.

## What the proxy must do

- **Forward everything to port 8080** of the container. Renplay serves the library, the games and
  the API from one origin.
- **Pass `Range` requests through, and do not cache or rewrite bodies.** The browser resumes the
  game download with Range requests, and games stream assets that way.
- **Allow long requests and large downloads.** Game files are large. Uploads are sent in chunks of 32 MB,
  so a body limit of 40 MB is enough, but do not set a short read timeout.
- **Serve HTTPS.** Browsers only keep the game’s offline cache, and iPhone only treats Renplay as a
  home-screen app, over HTTPS or on `localhost`.

## Examples

Caddy:

```
renplay.example.com {
  reverse_proxy renplay:8080
}
```

nginx:

```nginx
location / {
  proxy_pass http://renplay:8080;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_request_buffering off;
  proxy_buffering off;
  proxy_read_timeout 300s;
  client_max_body_size 40m;
}
```

Traefik, Cloudflare Tunnel and others work the same way: one service on port 8080.

For sign-in use your proxy’s own: basic auth, forward auth (Authelia, Authentik), Cloudflare Access
and similar. Renplay does not need to know about it.

## Notes

- Some gateways remove `Accept-Encoding` or decode gzip on the way. Renplay already serves the
  Ren’Py engine as pre-compressed files for that reason.
- HTTP/3 can drop long downloads through some gateways. The player resumes by itself; see
  [Troubleshooting](/troubleshooting/#downloads-stop-with-a-network-error-http3).
- Scale-to-zero proxies: see `RENPLAY_KEEPALIVE_URL` in [Configuration](/configuration/).
