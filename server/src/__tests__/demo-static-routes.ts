/*
 * Every route of the server, with what the static demo does about it. The static demo answers /api/ in the browser
 * (demo/static/sw/), so a route added to the server changes nothing there until someone decides: the routes test fails
 * until the new route is listed here, and a route listed as answered needs a case in the contract test.
 *
 * answered: the stand-in answers it, and the contract test compares its answer with the real server's.
 * file: a plain file of the static output (the game page, the runtime, the pictures).
 * limited: the demo server's guest may call it, and the static demo refuses it on purpose, since playing does not need it
 *   (demo-refusals.ts). The library hides what needs it (Me.demoStatic) and the static demo's limits test calls each.
 * hidden: the demo's guest may call it on the server, but the stand-in has no answer (404 for a read, 403 for the rest),
 *   and the library hides what needs it when it runs without a server (Me.demoStatic).
 * refused: the demo or the player rules refuse it for the guest, and the stand-in refuses it the same way.
 */
export const DEMO_ROUTES = {
  answered: [
    'GET /me', 'GET /me/adult', 'GET /me/tags', 'GET /auth/providers', 'GET /health', 'GET /defaults', 'GET /content', 'GET /widget', 'GET /catalog',
    'GET /history', 'GET /games', 'GET /games/:id', 'POST /auth/demo', 'POST /telemetry/client', 'GET /:id', 'GET /:id/boot', 'GET /:id/history',
    'POST /games/:id/played', 'POST /games/:id/play-time', 'PUT /games/:id/cache', 'PUT /:id/file', 'GET /:id/raw', 'GET /:id/screenshot',
    'PUT /:id/meta', 'DELETE /:id/file',
  ],
  limited: [
    'PUT /games/:id/favorite', 'PUT /games/:id/status', 'PUT /games/:id/rating', 'POST /games/:id/not-now', 'DELETE /games/:id/not-now',
    'GET /:id/download', 'DELETE /:id/slot', 'POST /:id/history/restore',
  ],
  file: [
    'GET /^\\/g\\//', 'GET /g/:id/:build/,/g/:id/:build/index.html', 'GET /renplay/runtime.js', 'GET /art/:file',
  ],
  hidden: [
    'GET /api/games/:id/offline', 'GET /games/:id/art', 'PUT /games/:id/art', 'DELETE /games/:id/art', 'GET /saves-export', 'GET /:id/export',
    'GET /avatars/:file', 'GET /api/auth/check', 'GET /keepalive', 'POST /auth/logout', 'POST /auth/switch', 'GET /auth/switch',
    'GET /auth/oidc/start', 'GET /auth/oidc/callback', 'POST /auth/login', 'POST /auth/setup', 'POST /auth/setup/verify', 'GET /',
  ],
  refused: [
    'DELETE /archives', 'DELETE /games/:id', 'DELETE /games/:id/art/uploads/:upload', 'DELETE /games/:id/download', 'DELETE /games/:id/files/raw',
    'DELETE /games/:id/update-not-now', 'DELETE /games/:id/walkthroughs/:file', 'DELETE /jobs', 'DELETE /me/identities', 'DELETE /me/sessions',
    'DELETE /me/sessions/:id', 'DELETE /me/tokens/:id', 'DELETE /system/storage/saves/:folder', 'DELETE /uploads/:id', 'DELETE /users/:id', 'GET /archives', 'GET /games/:id/files',
    'GET /games/:id/files/raw', 'GET /games/:id/recipe', 'GET /jobs', 'GET /jobs/:id/log', 'GET /me/identities', 'GET /me/sessions', 'GET /me/tokens',
    'GET /metrics', 'GET /system', 'GET /system/backups', 'GET /system/backups/:name', 'GET /system/storage', 'GET /uploads/:id', 'GET /users',
    'GET /users/:id/saves/export', 'POST /', 'POST /:id/copy', 'POST /:id/import', 'POST /:id/save-dir', 'POST /:id/sync', 'POST /:id/sync/download', 'POST /archives/hash',
    'POST /archives/inspect', 'POST /catalog/refresh', 'POST /games/:id/art/upload', 'POST /games/:id/files/apply', 'POST /games/:id/files/reset',
    'POST /games/:id/files/revert', 'POST /games/:id/files/upload', 'POST /games/:id/reinstall', 'POST /games/:id/safe',
    'POST /games/:id/update-not-now', 'POST /games/:id/walkthroughs', 'POST /imports', 'POST /jobs/:id/cancel', 'POST /jobs/:id/move',
    'POST /jobs/:id/pause', 'POST /jobs/:id/resume', 'POST /jobs/:id/retry', 'POST /me/avatar', 'POST /me/claim-owner', 'POST /me/identities/ldap',
    'POST /me/identities/oidc', 'POST /me/password', 'POST /me/tokens', 'POST /system/backups', 'POST /system/engines/refresh', 'POST /system/prune',
    'POST /system/storage/deleted-saves/:entry/restore', 'POST /system/storage/refresh', 'POST /uploads', 'POST /uploads/:id/complete', 'POST /users', 'POST /users/:id/merge', 'POST /users/:id/password',
    'POST /users/:id/saves/copy', 'POST /users/:id/saves/import', 'PUT /content', 'PUT /defaults', 'PUT /games/:id/files/raw',
    'PUT /games/:id/walkthroughs/:file', 'PUT /me', 'PUT /me/adult', 'PUT /me/pin', 'PUT /me/tags', 'PUT /system/downloads', 'PUT /system/sync',
    'PUT /system/telemetry', 'PUT /uploads/:id', 'PUT /users/:id',
  ],
}

export const ANSWERED: string[] = DEMO_ROUTES.answered
