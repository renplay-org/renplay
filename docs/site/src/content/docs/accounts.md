---
title: Accounts
description: Sign-in, separate saves, shared libraries and moving between accounts.
---

Renplay supports local accounts, OpenID Connect (OIDC) and LDAP. Everyone shares the games, but saves, save history, favourites,
Finished, play time and last played belong to each person. HTML games' stored progress is separate
too. Admins manage games and users; players play and manage their own saves.

## First start

A new data folder requires sign-in. Open Renplay and enter the **Setup code** from the server log:

```sh
docker logs renplay | grep "Setup code"
```

Choose the owner's name, username and password (at least 10 characters). The owner keeps any saves
made before sign-in was enabled. The code changes on each server start and allows ten attempts;
restart Renplay if those attempts run out.

To seed the owner instead, set `RENPLAY_ADMIN_USERNAME` and `RENPLAY_ADMIN_PASSWORD_FILE` (a file
containing the password). `RENPLAY_ADMIN_PASSWORD` also works. Set only one password source. These
variables claim an unclaimed owner, not reset an existing password.

Sign-in stays off after an upgrade, with an admin reminder. Set `RENPLAY_AUTH=on` and restart when
ready. The first admin claims the owner and all the saves made without sign-in.

## Sign-in and sessions

Sign-in lasts 30 days from your last use. Open **Account** from the account menu or the phone's
**You** tab. Change your display name or password, see where you are signed in, and sign out of
individual sessions or everywhere else. Changing your password ends your other sessions.

**Access tokens** creates named tokens for scripts. Copy a new token immediately: it is only shown
once. Revoke it from the same list when it is no longer needed. **Your saves → Export all my saves**
downloads current save folders for games you can see as one zip; hidden saves and history stay on
the server.

The account menu also has **Sign out**. If sign-in ends during play, the player asks you to sign in in another
tab. Return and press **Continue** to sync without losing the scene. Use the same account that
started that game. A shared browser never uploads another account's queued saves. Unsent Ren'Py
and HTML saves stay on that device under their owner's account until the same account returns.
HTML games sync a returning account's pending changes before opening again; connect and retry
if that sync fails. Do not clear browser storage while changes are waiting to sync.

Browser saves from before accounts are attributed only to the known owner of an upgraded
single-user installation, never to an arbitrary player. If their owner cannot be established,
Renplay keeps them and shows a notice. Ask an admin to recover those files on the same device;
[developer recovery notes](/developers/accounts-api/#unowned-browser-save-recovery) explain how.

Use HTTPS outside a trusted local network. Cookies are httpOnly and SameSite=Lax; they also have
`Secure` over HTTPS, but work on plain HTTP for local NAS installs. Set `RENPLAY_PUBLIC_URL` to
your HTTPS address when a proxy terminates HTTPS. See [Reverse proxy and HTTPS](/install/reverse-proxy/).

## Local passwords

Local sign-in is enabled by default. Passwords have at least 10 characters. Admins can add local
users and reset their passwords in **Users**. Password changes end the other sessions.

Set `RENPLAY_AUTH_LOCAL=false` to disable local password authentication when another provider is
configured. With OIDC only, this hides the password form. LDAP still uses the directory password
form. Renplay checks OIDC discovery and the LDAP service bind at startup; invalid provider settings
stop startup rather than leaving an unusable sign-in page. SSO-only configurations must also set
an admin group, filter or `RENPLAY_ADMINS`.

## OpenID Connect

Register Renplay as an OIDC application in your provider. Its callback URL is exactly:

```text
https://play.example.org/api/auth/oidc/callback
```

Set `RENPLAY_PUBLIC_URL` to your Renplay address, not the provider's. Renplay discovers endpoints
from the issuer, requests `openid profile email groups`, and uses the authorization code flow with
PKCE (S256), state and nonce. The signed identity token must match the issuer, client and request.
The issuer, authorization, token and key endpoints require HTTPS (loopback HTTP is allowed for local
tests). Keep the client secret in a secret file where possible; do not put it in a public compose file.

```sh
RENPLAY_PUBLIC_URL=https://play.example.org
RENPLAY_OIDC_ISSUER=https://id.example.org
RENPLAY_OIDC_CLIENT_ID=renplay
RENPLAY_OIDC_CLIENT_SECRET_FILE=/run/secrets/oidc-client-secret
RENPLAY_OIDC_NAME="Pocket ID"
RENPLAY_OIDC_ADMIN_GROUP=renplay-admins
RENPLAY_OIDC_ADULT_GROUPS=renplay-adults=shown,renplay-family=blurred
```

Accounts are matched by issuer and subject, never by email or display name. First sign-in creates
a player unless an admin rule matches. Set `RENPLAY_OIDC_AUTO_CREATE=false` to require linking from
an existing signed-in account first. This also prevents creating the first owner through OIDC;
claim a local owner before disabling local sign-in in that mode.

`RENPLAY_ADMINS` is a comma-separated list of provider usernames or emails. An email only counts
when the OIDC token has `email_verified: true`. An admin group, when configured, takes precedence
over this list. Changing an email or name never links accounts. Allowlist grants are checked again
at each sign-in through that identity and removed when it is unlinked. Removing someone from the
list takes effect at their next provider sign-in. Admin access assigned in **Users** is independent
and is never removed by provider sign-in.

### Pocket ID

Create an OIDC client, set the exact callback above, and copy its client id and secret. Use Pocket
ID's published issuer URL (normally its root address) as `RENPLAY_OIDC_ISSUER`. Add the two groups
to Pocket ID and assign people to them. Ensure they are present as strings in the ID token's
`groups` array; use their exact values in the two Renplay group settings. The button name can be
`Pocket ID` as in the example.

### Authentik

Create an OAuth2/OpenID provider with a confidential client, the exact callback, and the
`openid`, `profile`, `email` and `groups` scope mappings. Associate it with an application whose
slug is `renplay`. Use the issuer shown on its provider page, for example:

```sh
RENPLAY_OIDC_ISSUER=https://auth.example.org/application/o/renplay/
RENPLAY_OIDC_NAME=Authentik
```

If the standard mappings omit groups from the ID token, add a `groups` scope mapping returning
`{"groups": [group.name for group in request.user.ak_groups.all()]}`. Assign group names matching
`RENPLAY_OIDC_ADMIN_GROUP` and the groups in `RENPLAY_OIDC_ADULT_GROUPS`.

### Authelia

Register a confidential OIDC client with the exact callback and scopes
`openid`, `profile`, `email`, `groups`. Enable the authorization code grant, response type `code`,
PKCE S256 and `client_secret_basic` token authentication. Use the Authelia root URL as issuer:

```sh
RENPLAY_OIDC_ISSUER=https://auth.example.org
RENPLAY_OIDC_NAME=Authelia
```

Make the `groups` claim available in the ID token, including it through a claims policy if required
by your Authelia version. A claim only in the user-info response does not control Renplay permissions.
The trusted `Remote-User` header is not a supported sign-in provider.

### Keycloak

Create an OpenID Connect client in your realm with standard flow enabled, direct access grants
disabled, client authentication enabled and the exact callback. Set PKCE to S256. Add a client
scope named `groups` with a Group Membership mapper, token claim name `groups`, full group path
**off**, and **Add to ID token** enabled. Make that scope available to this client.

```sh
RENPLAY_OIDC_ISSUER=https://id.example.org/realms/home
RENPLAY_OIDC_NAME=Keycloak
```

If you keep full group paths enabled, use values such as `/renplay-admins` in Renplay instead.
All examples also need `RENPLAY_PUBLIC_URL`, the client id and the client secret from the common
example. Consult your provider's current documentation for its configuration file syntax.

## LDAP and LLDAP

LDAP uses the password form. Renplay searches with its service account, binds as the matching
person to check the password, then checks group filters with the service account. The default
user filter works with LLDAP. Start with a dedicated read-only service account with permission
to see users, photos and groups (the example DN must exist in your directory):

```sh
RENPLAY_LDAP_URL=ldaps://ldap.example.org:636
RENPLAY_LDAP_BIND_DN=uid=renplay,ou=people,dc=example,dc=org
RENPLAY_LDAP_BIND_PASSWORD_FILE=/run/secrets/ldap-password
RENPLAY_LDAP_BASE_DN=dc=example,dc=org
RENPLAY_LDAP_USER_FILTER='(&(objectClass=person)(uid={username}))'
RENPLAY_LDAP_ADMIN_FILTER='memberOf=cn=renplay-admins,ou=groups,dc=example,dc=org'
RENPLAY_LDAP_ADULT_GROUPS=renplay-adults=shown,renplay-family=blurred
```

For LLDAP's default internal listener use `ldap://lldap:3890` only on a trusted private network.
For other directories offering StartTLS, use `ldap://` with `RENPLAY_LDAP_STARTTLS=true`. TLS is
verified; `RENPLAY_LDAP_CA_FILE` accepts your private PEM CA. A failed TLS upgrade never falls
back to plaintext. Do not send directory passwords over an untrusted plaintext network.

Attribute settings are `RENPLAY_LDAP_USERNAME_ATTRIBUTE=uid`,
`RENPLAY_LDAP_NAME_ATTRIBUTE=displayName` (falls back to `cn`),
`RENPLAY_LDAP_EMAIL_ATTRIBUTE=mail` and `RENPLAY_LDAP_PHOTO_ATTRIBUTE=jpegPhoto`.
`{username}` is escaped wherever it appears in the user filter. Exactly one entry must match.
The identity uses `entryUUID`, falling back to the entry DN if the directory does not supply it.
Changing the directory URL or base DN creates a different provider; link it explicitly again.
LDAP emails do not carry OIDC's verification proof, so use usernames, not emails, in
`RENPLAY_ADMINS` for directory admins.

**An enabled local username takes precedence.** If it exists locally, a wrong local password does
not fall through to LDAP, even if the directory has the same username. When local authentication
is disabled, that username can use LDAP only if the authenticated directory identity is already
explicitly linked to the same Renplay account. Link it while signed in before disabling local
sign-in. Renplay never silently merges a local and directory account. Other directory users are
created on first sign-in.

### Group-driven permissions

Configured admin groups or filters grant admin access, and adult groups set the highest adult games
level of their members. `RENPLAY_OIDC_ADULT_GROUPS` and `RENPLAY_LDAP_ADULT_GROUPS` take
`group=off|blurred|shown` pairs separated by commas. OIDC matches the groups claim exactly, LDAP the
cn of the user's memberOf groups, ignoring case. A person in several groups gets the highest of
their levels, and a person in none gets Off. The 3.x variables still work:
`RENPLAY_OIDC_ADULT_GROUP=name` means that group gets Shown, and a match of
`RENPLAY_LDAP_ADULT_FILTER` gets Shown. Both are refreshed at every sign-in through that provider,
including revocations. **Users** shows whether admin access
was assigned in Renplay, granted by `RENPLAY_ADMINS`, or set by a provider group. Provider-managed
permissions cannot be edited there. Admin access assigned directly in **Users** is kept across all
provider sign-ins and unlinking. Missing or malformed groups grant neither permission. A configured
adult group can restrict even the owner. The installation's level always wins. With several linked
providers, the last provider sign-in that manages a permission sets it, unless admin access was
assigned directly in Renplay. Local password sign-in does not refresh directory groups. Changes
are applied at the next provider sign-in, not continuously in the background.

Revoking the last provider-managed admin still removes admin access. Renplay logs a warning.
To recover, add that person back to the provider's admin group and sign in again. Alternatively,
remove that provider's admin group/filter setting, add the person's provider username or verified
OIDC email to `RENPLAY_ADMINS`, restart Renplay, and sign in again. The group/filter takes precedence
while it is configured. Prefer groups or verified emails when people can choose their own usernames.

The first new SSO admin claims the unclaimed owner and its existing saves. An admin who already
signed in before becoming an admin can use **Account → Claim the owner account** while it remains
unclaimed. Existing personal saves are copied with history, not deleted or discarded. Renplay
reserves the claim before copying, so a competing claim cannot change owner saves. If copying
fails, the reservation is released so you can retry. After a server interruption, restart Renplay
and sign in again. If the owner is still unclaimed, retry from the original account. Partial
copies stay recoverable in save history.

## Linked sign-ins

**Account → Linked sign-ins** links OIDC after you complete the provider's sign-in, or LDAP after
you enter your directory credentials. You must stay signed in to the same Renplay session while
linking. An identity already belonging to another account cannot be linked or silently merged.
You can unlink a method only when another usable method remains with the current configuration.
A directory username reserved by another local account does not count. Unlinking ends other
sessions. If the sign-in supplied the current admin grant, unlinking removes it, including grants
from `RENPLAY_ADMINS`. Admin access assigned in **Users** is kept. Unlinking a provider with adult
groups sets that account's adult games level to Off. The last enabled admin must keep its admin method
until another admin exists. Unavailable providers and disabled local passwords do not count as
working remaining sign-in methods.

## Profile pictures

Upload a JPEG, PNG or WebP up to 2 MiB in **Account**, preview a square crop, adjust its zoom and
save. Images are limited to 16 megapixels and stored as content-addressed 256 px WebP files under
`/data/avatars/`. Pictures have the same sign-in protection as the library. Otherwise Renplay copies
OIDC `picture` or LDAP `jpegPhoto` at sign-in; it never hotlinks the provider. Remote pictures must
use HTTPS on port 443, cannot redirect or access private network addresses, and have a 2 MiB cap.
Unavailable or invalid provider pictures do not prevent sign-in. Your own upload takes precedence
over later provider pictures. Without a picture, Renplay uses initials on the accent gradient.

## Without sign-in

`RENPLAY_AUTH=off` lets everyone play as the owner (account 1). `RENPLAY_AUTH_USER` can choose a
different account id. Nothing moves when you change the mode. Other accounts' saves stay in their
folders and return when sign-in is enabled again.

Without sign-in, everyone has the chosen account's permissions. Keep an open admin account on a
trusted network or behind your own authentication. Disabling sign-in is not a way to separate people.

## Adult games

Adult games have three levels, Off, Blurred and Shown, set in four layers that only narrow: the
installation, each person's account (set by an admin in **Users**, or by a sign-in group), the
person's own choice, and the device. New people start at `RENPLAY_ADULT_DEFAULT`, Off unless you
set it. The first admin starts at Shown unless a sign-in group says otherwise.

**Account → Adult games** shows the four rows and says what you see and why. Games with no recipe
count as adult for a person at Off until an admin marks them safe.
See [Adult games](/start-here/adult-games/).

## Users

Open **Settings → Users** (admins only) to add users, change roles and adult games levels, disable or
re-enable an account, or reset its password. Each row shows games with save folders and the number
of current save files (including persistent and HTML storage, excluding shared keys and history).
Users cannot demote, disable or remove the last enabled admin. Add another admin first.
Provider sign-in can still revoke the last provider-managed admin grant as described above.

Use each user's actions for **Copy saves…**, **Merge into another user…**, **Export save folder**,
**Import a save folder** or **Remove user…**. **Moving saves** also opens copy and import tools.
The [Accounts API](/developers/accounts-api/) offers the same operations for scripts.

With sign-in off, **Account** explains which account everyone uses. **Users** still works for
admins, so accounts and saves can be prepared before sign-in is turned on.

An admin can copy one game's saves or all save folders to another account, merge accounts, or
export and import a whole save folder as a zip. Overwrites go into the target's history. Removing
or merging an account archives its folder under `/data/users-removed/`; Renplay does not purge it.
The owner and the account selected for no-sign-in play cannot be removed.

Save imports accept up to 200 files, 64 MiB per uploaded file and 128 MiB per request. A zip may
contain at most 2,048 entries, 64 MiB per expanded entry and 128 MiB of expanded contents. Links,
special files and unsafe paths are refused before extraction. Two imports can run at once;
try again shortly if another import is using the available slots.

## Backups and rollback

Back up all of `/data`, including `/data/users/` and `/data/users-removed/`. Each user folder has a
`user.json` identifying its owner. The upgrade first backs up saves, save history and `library.db`
under `/data/backups/pre-3.0/`, then moves the old folders under `/data/users/1/`. It leaves symlinks
at the old paths, including custom `SAVES_DIR` and `SAVE_HISTORY_DIR` paths.

The migration resumes after an interruption, and copies and verifies when the folders live on
another volume. Conflicting files from an interrupted partial copy stay in the owner's
`migration-conflicts/` folder. The filesystem must support symlinks; otherwise startup stops rather
than silently leaving an incompatible old layout. Keep your own backup as well.

Renplay 2.10 can still use the old owner save paths through those symlinks. It cannot see other
accounts. Do not run both versions at once. See [Upgrading](/upgrading/) for the general rollback rule.
