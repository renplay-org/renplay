---
title: Reverse proxy and HTTPS
description: Put Renplay behind a reverse proxy, with sign-in and HTTPS.
---

New Renplay installs require local sign-in. Upgraded installs keep sign-in off until you enable
it with `RENPLAY_AUTH=on`; see [Accounts](/accounts/). Use HTTPS outside your trusted network.
You can also put Renplay behind a VPN or your proxy's authentication.

## What the proxy must do

- **Forward everything to port 8080** of the container. Renplay serves the library, the games and
  the API from one origin.
- **Pass `Range` requests through, and do not cache or rewrite bodies.** The browser resumes the
  game download with Range requests, and games stream assets that way.
- **Allow long requests and large downloads.** Game files are large. Uploads are sent in chunks of 32 MB,
  so a body limit of 40 MB is enough, but do not set a short read timeout.
- **Set `RENPLAY_PUBLIC_URL`** to your public HTTPS address when the proxy terminates HTTPS.
  Cookies are marked `Secure` over HTTPS; plain HTTP remains usable on a local NAS. Set
  `RENPLAY_TRUSTED_HOPS` to the trusted proxy hop count for client-address rate limits (the
  included nginx counts as one). Do not expose Node directly with a nonzero count.
- **Serve HTTPS.** Browsers only keep the game’s offline cache, and iPhone only treats Renplay as a
  home-screen app, over HTTPS or on `localhost`.

## Caddy

Caddy gets a certificate for your domain by itself. This `compose.yaml` runs Renplay and Caddy
together, with a `Caddyfile` next to it (both in
[deploy/caddy](https://github.com/renplay-org/renplay/tree/main/deploy/caddy)). Put your domain in
both, point the domain at the server, and open ports 80 and 443 to it.

```yaml file=deploy/caddy/compose.yaml
```

```text file=deploy/caddy/Caddyfile
```

## nginx

An nginx site in front of Renplay
([deploy/nginx/renplay.conf](https://github.com/renplay-org/renplay/blob/main/deploy/nginx/renplay.conf)).
Set `RENPLAY_PUBLIC_URL` to the `https://` address and `RENPLAY_TRUSTED_HOPS` to `2`.

```nginx file=deploy/nginx/renplay.conf
```

## Others

Traefik, Cloudflare Tunnel and others work the same way: one service on port 8080.

Optional proxy sign-in (basic auth, Authelia, Authentik or Cloudflare Access) is an extra boundary,
not a Renplay identity provider. Keep Renplay sign-in on to separate people's saves. For single
sign-on, Renplay's own sign-in uses OIDC or LDAP. See [Accounts and sign-in](/accounts/).

## Notes

- Some gateways remove `Accept-Encoding` or decode gzip on the way. Renplay already serves the
  Ren’Py engine as pre-compressed files for that reason.
- HTTP/3 can drop long downloads through some gateways. The player resumes by itself. See
  [Troubleshooting](/troubleshooting/#downloads-stop-with-a-network-error-http3).
- Scale-to-zero proxies: see `RENPLAY_KEEPALIVE_URL` in [Configuration](/configuration/).

The image names, ports, paths and upgrade promise are covered by the
[3.x stability contract](/stability/).
