---
title: Accounts API
description: Local accounts, sessions, tokens, permissions and save transfers.
---

These endpoints back the Account and Users screens. `identities` is keyed by `(provider, subject)`:
OIDC providers include the issuer and use the token subject; LDAP providers include directory URL
and base DN and use entryUUID (or DN). Linking is explicit, never based on an email or name.
See [Accounts](/accounts/) for provider configuration.

## Authenticate scripts

Use a cookie jar to sign in, then issue a personal access token. Replace the example address and
credentials. Keep tokens private; the server only stores their hashes and returns a token once.

```sh
base=http://localhost:8080
curl --fail -c /tmp/renplay-cookie -H "Origin: $base" -H 'Content-Type: application/json' \
  -d '{"username":"owner","password":"replace this password"}' "$base/api/auth/login"
curl --fail -b /tmp/renplay-cookie -H "Origin: $base" -H 'Content-Type: application/json' \
  -d '{"name":"Upload script"}' "$base/api/me/tokens"
rm /tmp/renplay-cookie
```

Send `Authorization: Bearer <token>` afterwards. Tokens carry their user's current role and adult
access, and stop working when revoked or the account is disabled. Cookie mutations require
`Sec-Fetch-Site: same-origin` or `none`, or a matching `Origin` when that header is absent (or
same-site). No content-type restriction is imposed: JSON, multipart, octet-stream and empty DELETEs
all work. Bearer tokens bypass CSRF checks.

## Endpoints

All paths below start with `/api`. Management endpoints require an admin; `/me` is personal.
Passwords must have 10–1024 characters; usernames use 2–64 ASCII letters, numbers, dots, dashes or
underscores and are case-insensitive. API paths, unlike usernames, are case-sensitive and have
no trailing slash (including `/api/auth/check`). Repeated slashes and encoded path separators
are rejected rather than matched differently by authorization and routing.

| Method and path | Body or result |
|---|---|
| `GET /auth/providers` | `{ enabled, setup, local, oidc, ldap }`; public. `local` means the password form is available (local or LDAP); `oidc` is its button name or null |
| `POST /auth/setup/verify` | `{ code }` → `{ grant }`; public, ten attempts per boot |
| `POST /auth/setup` | `{ grant, username, name, password }`; claims owner and sets a cookie |
| `POST /auth/login` | `{ username, password }`; rate limited per address and account |
| `GET /auth/oidc/start` | Starts sign-in; sets a ten-minute httpOnly state cookie and redirects to the provider |
| `GET /auth/oidc/callback` | Single-use state plus bound cookie; exchanges code with PKCE, verifies ID token, sets a session and redirects home |
| `GET /me/identities` | Linked `{ provider, subject, name, available }` methods; never passwords |
| `POST /me/identities/oidc` | Returns `{ url }`; starts explicit linking bound to the current session |
| `POST /me/identities/ldap` | `{ username, password }`; verifies credentials before linking |
| `DELETE /me/identities` | `{ provider, subject }`; keeps an enabled method, removes provider grants and ends other sessions |
| `POST /me/avatar` | Raw JPEG, PNG or WebP, up to 2 MiB and 16 megapixels; returns `{ avatar }` filename |
| `GET /avatars/:file` | Authenticated WebP; private/no-store |
| `POST /auth/logout` | Revokes the current cookie session |
| `GET /me` | `{ user, auth, unclaimed, hasPassword }` |
| `PUT /me` | `{ name }` |
| `POST /me/password` | `{ current, password }`; ends other sessions |
| `POST /me/claim-owner` | Admin only, while unclaimed; copies saves with history, moves identities, archives the old folder |
| `GET /me/prefs` | `{ adultPictures }`, absent means `hide-pictures` |
| `PUT /me/prefs` | `{ adultPictures: "show" \| "hide-pictures" \| "hide-games" }` |
| `GET /me/sessions` | `{ sessions }`, including `current` and creation, touch and expiry times |
| `DELETE /me/sessions` | Ends every session except this one |
| `DELETE /me/sessions/:id` | Ends that session |
| `GET /me/tokens` | `{ tokens }`; never includes secrets |
| `POST /me/tokens` | `{ name }` → `{ id, token }` |
| `DELETE /me/tokens/:id` | Revokes that token |
| `GET /users` | `{ users, adultDefault }`; `adultDefault` is the new-user adult-access default; each user includes `avatar`, `roleManaged`, `adultManaged`, `games` (nonempty save folders), `saves` (current files in those folders, excluding shared keys and history), `protected` (owner or no-sign-in account) |
| `POST /users` | `{ username, name?, password, role?, adultAccess? }` → `{ user }`; role defaults to `player` |
| `PUT /users/:id` | `{ name?, role?, disabled?, adultAccess? }` |
| `POST /users/:id/password` | `{ password }`; ends all target sessions |
| `DELETE /users/:id` | Archives the folder, removes credentials and personal rows |
| `POST /users/:id/saves/copy` | `{ target: userId, game?: gameId }`; one game includes its verification keys; omitting game copies all folders and shared data |
| `POST /users/:id/merge` | `{ target: userId }`; copies saves, combines progress, archives the source |
| `GET /users/:id/saves/export` | Whole save-folder zip, including shared keys and HTML storage |
| `POST /users/:id/saves/import` | Multipart `file`: zip whose entries are `<save folder>/<file>`; overwrites keep target history |
| `POST /games/:id/safe` | `{ safe: boolean }`; only for games with no catalog recipe |

The last enabled admin cannot be disabled, demoted or removed. The owner and `RENPLAY_AUTH_USER`
account cannot be removed or merged away. Removal disables the account and drains accepted writes
before archiving its folder; stale requests cannot recreate it. Concurrent removals still keep an
enabled admin. Save exports are current files, not a replacement for a backup of save history. Merges keep the latest timestamps and the larger play-time value rather
than double-counting copied progress.

## Route permissions

Players can list games and the permitted catalog, play, read walkthroughs, change their own
favourites, Finished, last played and play time, and use their own save, history, import, copy and
export endpoints. Install progress remains visible on cards, read only.

Only admins can install, reinstall, uninstall, use archives or uploads, browse or change game
files and mods, change walkthroughs, upload compiled caches, export recipes, refresh the catalog,
change instance content mode, inspect system paths, prune or refresh engines, view Activity or
control jobs, and manage users. New routes default to admin-only unless the player allowlist is
extended and tested.

## Database and request boundary

Schema **8** adds `avatar` and `avatar_uploaded` to users; schema 7 (2.10 already uses schema 6) adds `users`, `identities`, `sessions`, `tokens`,
`user_games` and `safe_games`. Owner 1 receives existing library progress. Account ids are never
reused. The migration backs up the checkpointed database and both save trees before moving any
folder and only commits the new schema after folder migration succeeds.

A request-local viewer selects one `SaveStore` per user. Metadata keys include its root, screenshot
URLs include user id, and personalized responses are not stored in HTTP caches. Runtime requests
also carry `X-Renplay-User`: a still-open game cannot upload into another account after someone
changes the cookie in another tab. The Ren'Py IndexedDB mirror keys entries by user and path,
retains other users' entries without showing or replaying them, and stops its pump on 401.
Unsent changes wait for their owner to return. A newer server file does not discard an unsent
write: sending it preserves the previous server copy in history. The player can resume the
queue after signing in to the original account. HTML snapshots are durably queued at the trusted
parent origin in IndexedDB (`renplay-html-queue`), keyed by user, game and path. A returning
owner's queue syncs before loading the HTML page with server-side storage; successful writes
remove only the matching snapshot. The opaque-origin runtime waits for a durable-storage
acknowledgement before clearing its localStorage dirty flag.

`games.last_played_at` remains the maximum across accounts for older versions and catalog linking.
API game progress comes from `user_games`, not the shared row.

Sessions are opaque 256-bit values, hashed with SHA-256 in SQLite. They expire after 30 days,
sliding with database writes at most every five minutes. The node-side session cache is bounded,
refreshes every five seconds and is invalidated immediately for in-process revocations. Role,
disabled and adult access are read live. Passwords use salted scrypt from `node:crypto`, stored as
`scrypt$1$131072$8$1$<salt>$<key>` (`N=131072`, `r=8`, `p=1`, 256 MiB `maxmem`). Legacy
`salt:key` hashes still verify at their original work factor and upgrade after a successful
sign-in; concurrent password resets cannot be overwritten by an upgrade.

Save imports spool multipart files to a private temporary folder, process one uploaded file at
a time, and clean up on success or failure. Personal and admin imports share a two-request
concurrency budget. Compressed upload limits are 64 MiB per file and 128 MiB aggregate file data
per request, with bounded multipart fields and parts. Zip limits are 2,048 entries, 64 MiB per
expanded entry and 128 MiB total expansion. All directory entries are validated before any
content stream opens, including entries that will not be imported. Traversal, duplicate paths,
links and special files are refused. Limit errors return 413 (multipart per-file errors return
400); a busy import budget returns 429.

## nginx and sandboxed games

`auth_request` is inherited at server level by static covers, walkthroughs and build files. The UI,
its assets, public engine and runtime stay open. Proxied game and API routes turn it off and check
permissions in Node. Health is public; keepalive requires a random per-boot bearer secret used only
by the job runner. `RENPLAY_TRUSTED_HOPS` replaces unrestricted proxy trust.

Each protected static location captures nginx's decoded, slash-merged, dot-normalized `$uri`
before the auth subrequest changes it to `/_renplay_auth`. The subrequest sends that captured
path as `X-Original-URI`, and its cache key uses the same normalized path. Node never decodes it
a second time and denies malformed or unrecognized resources before checking game visibility. Unavailable static files return 403 to the subrequest (nginx only accepts 2xx, 401 or
403), while ordinary application routes keep their 404 response. Successful static checks are
cached for **60 seconds**, keyed by cookie, bearer and URI. Revocation and permission changes therefore take up to a minute for nginx-served static
files. Proxied requests and signed HTML URLs are revoked immediately by the application. Browsers
must not cache protected static responses; public engines remain immutable.

Sandboxed HTML frames have an opaque origin and no cookie. Their URL is
`/g/<game>/<build>/s/<session-hash>.<HMAC>/game/<entry>`. The per-boot HMAC covers the live session,
game and build. Every request verifies that session (or access token) and uses its user's save
store for the entry page. Relative URLs continue to work. Sign-out, disabling the account, token
revocation and restart invalidate these URLs; they do not expire midway through a live session.
The middleware sets an explicit verified-capability flag; URL query text cannot stand in for a
verified signature. Every HTML page (also SVG/XML documents) in an HTML game's asset pack sends
a response-level CSP `sandbox` without `allow-same-origin` or popup escape. The iframe uses the
same restrictions. Popups may open, but inherit the opaque-origin sandbox, even outside the
player. A browser may refuse a popup as it normally would; no exception grants it account access.

## Unowned browser save recovery

An upgraded single-user installation identifies legacy, unowned Ren'Py mirror entries as belonging
to owner 1. Other accounts cannot claim them. On installations without that history, unowned
entries stay untouched and the player shows a notice. No guessed attribution or cleanup is done.

For manual recovery, open developer tools on the **same Renplay origin and browser profile**.
In Storage/Application → IndexedDB → `renplay` → `files`, inspect entries without `userId`.
Have the player identify their own game and paths before exporting anything. Copy the entry's
`data` bytes to a file with its original basename, then use that account's save import. A
`data: null` entry records a pending deletion, not a save file. Do not delete or edit the original
entries, clear site storage, or copy them into another account automatically. Keep the originals
until the player has verified the imported saves. The owner-prefixed entries and the separate
HTML queue do not need manual recovery: they return only to their own account.
