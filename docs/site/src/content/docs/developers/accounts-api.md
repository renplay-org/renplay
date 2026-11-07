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
games levels, and stop working when revoked or the account is disabled. Cookie mutations require
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
| `GET /me/identities` | Linked `{ provider, subject, name, available, removable }` methods. Availability reflects current configuration and reserved usernames. Removability checks the methods usable after unlinking. Never includes passwords |
| `POST /me/identities/oidc` | Returns `{ url }`. Linking rechecks the initiating session or token in live storage after the provider exchange |
| `POST /me/identities/ldap` | `{ username, password }`. Verifies credentials and rechecks the initiating session or token before linking |
| `DELETE /me/identities` | `{ provider, subject }`. Keeps a usable method, removes current grants from that identity and ends other sessions. Admin access assigned in Users is kept |
| `POST /me/avatar` | Raw JPEG, PNG or WebP, up to 2 MiB and 16 megapixels; returns `{ avatar }` filename |
| `GET /avatars/:file` | Authenticated WebP; private/no-store |
| `POST /auth/logout` | Revokes the current cookie session |
| `GET /me` | `{ user, auth, unclaimed, hasPassword }` |
| `PUT /me` | `{ name }` |
| `POST /me/password` | `{ current, password }`; ends other sessions |
| `POST /me/claim-owner` | Admin only, while unclaimed. Atomically reserves ownership before copying saves with history, moving identities and archiving the old folder. Competing claims return 409 before copying. A failed or interrupted claim can be retried |
| `GET /me/adult` | `{ installation: { level, fixed, chosen }, ceiling: { level, managed }, choice, effective }`. Levels are `off`, `blurred` or `shown`. `managed` is `group` when a sign-in group sets the ceiling. `effective` is the lowest of the three |
| `PUT /me/adult` | `{ level }`, at or below the account's ceiling, else 409 |
| `GET /me/sessions` | `{ sessions }`, including `current` and creation, touch and expiry times |
| `DELETE /me/sessions` | Ends every session except this one |
| `DELETE /me/sessions/:id` | Ends that session |
| `GET /me/tokens` | `{ tokens }`; never includes secrets |
| `POST /me/tokens` | `{ name }` → `{ id, token }` |
| `DELETE /me/tokens/:id` | Revokes that token |
| `GET /users` | `{ users, adultDefault }`. Each user includes `avatar`, `admin_source` (`manual`, `provider`, `allowlist`), `roleManaged`, `adultManaged`, `games` (nonempty save folders), `saves` (current files in those folders, excluding shared keys and history), and `protected` (owner or no-sign-in account). `adult_ceiling` and `adult_choice` are the person's levels. `adultDefault` is the level new people start at |
| `POST /users` | `{ username, name?, password, role?, adultCeiling? }` → `{ user }`; role defaults to `player`, the ceiling to `RENPLAY_ADULT_DEFAULT`, and the person's own level starts at the ceiling |
| `PUT /users/:id` | `{ name?, role?, disabled?, adultCeiling? }`. The ceiling is refused with 409 when a sign-in group sets it |
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

## Personal game and save routes

These are open to players and change only the person asking.

| Method and path | Body or result |
|---|---|
| `PUT /games/:id/status` | `{ status }`: `playing`, `stalled`, `dropped`, `finished`, or an empty string to clear it. Finished stays in step with `finished_at` |
| `PUT /games/:id/rating` | `{ rating }` from 1 to 5, 0 clears it |
| `POST /games/:id/not-now` | Takes the game out of Up next until it is played again. `DELETE` undoes it |
| `GET /games/:id/art?kind=` | The candidates for one format. `PUT` with `{ kind, candidate, scope }` chooses one, `DELETE` returns to the default. `scope` is `me`, or `everyone` for admins |
| `POST /games/:id/art/upload?kind=&scope=&focal=x,y` | Raw image body, kept on this server |
| `GET /history?days=&before=&game=` | Play sessions by day with totals, paged by `before` |
| `PUT /saves/:id/meta?file=` | `{ title?, note?, pinned? }`. The name and note are this person's. A pinned save keeps every version |
| `PUT /saves/:id/file?path=` | Raw body, with `x-mtime` and `x-base` (the server time of the version the device last saw, 0 for none). When another device saved the file in between, the newer copy stays and the answer says `conflict: kept` or `replaced` |
| `GET /saves/:id` | Slots with `title`, `note`, `pinnedAt`, and `screenshotHash` instead of `screenshot` at Blurred, plus `conflicts` from the last two weeks |
| `GET /saves-import` | `{ dirs, games, catalog }`: this person's save files by folder, and the games each folder belongs to |
| `POST /saves-import` | Multipart `meta` (a JSON list of `{ path, mtime }`) and `files` in the same order. Paths are `<save folder>/<file>` or `tokens/security_keys.txt`. Returns `{ added, replaced, kept, same, keys, skipped }` |

Admins also have `POST /games/:id/walkthroughs`, `PUT` and `DELETE /games/:id/walkthroughs/:file`,
and the save backups: `GET /system/backups`, `POST /system/backups` (back up now) and
`GET /system/backups/:name`.

## Route permissions

Players can list games and the permitted catalog, play, read walkthroughs, change their own
favourites, Finished, status, rating, Not now, art choices, last played and play time, read their
play history, and use their own save, name, note, pin, history, import, copy and export endpoints.
Install progress remains visible on cards, read only.

Only admins can install, reinstall, uninstall, use archives or uploads, browse or change game
files and mods, change walkthroughs, upload compiled caches, export recipes, refresh the catalog,
change instance content mode, inspect system paths, prune or refresh engines, view Activity or
control jobs, run or download save backups, choose art for everyone, and manage users. New routes
default to admin-only unless the player allowlist is extended and tested.

## Database and request boundary

Schema **10** records each user's current admin grant source and its provider and subject.
`manual` covers admin access assigned in Renplay, including accounts upgraded from 3.0.
It also adds `identity_metadata` to record the directory username used by a linked identity.
An `owner_claim` setting reserves ownership during copying. Startup clears an interrupted reservation
without deleting copied saves or history. Schema **9** adds `avatar` and `avatar_uploaded` to users.
Schema 8 records uploaded archive ownership. Schema 7 (2.10 already uses schema 6) adds `users`, `identities`, `sessions`, `tokens`,
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
disabled and the adult games levels are read live. Passwords use salted scrypt from `node:crypto`, stored as
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
