-- Renplay v4.0.0 (c07ff69c1c4b4e2ce49f86d3a321cd48893d4d30), server/src/db.ts.
-- SCHEMA plus its fresh-library migrations, exported through sqlite_schema.
-- Only DDL and the real user_version, no generated owner or settings rows.
CREATE TABLE archives (
    path       TEXT PRIMARY KEY,
    size       INTEGER NOT NULL,
    mtime_ms   INTEGER NOT NULL,
    sha256     TEXT NOT NULL DEFAULT '',
    info       TEXT NOT NULL DEFAULT '{}',
    scanned_at TEXT NOT NULL DEFAULT ''
  );
CREATE TABLE art_choices (game TEXT NOT NULL, kind TEXT NOT NULL, scope INTEGER NOT NULL, candidate TEXT NOT NULL, PRIMARY KEY (game, kind, scope));
CREATE TABLE art_made (key TEXT PRIMARY KEY, file1x TEXT NOT NULL, file2x TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, thumbhash TEXT NOT NULL, tint TEXT NOT NULL, made TEXT NOT NULL DEFAULT '', adult INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, dark INTEGER NOT NULL DEFAULT 0);
CREATE TABLE art_measured (id TEXT PRIMARY KEY, width INTEGER NOT NULL, height INTEGER NOT NULL, thumbhash TEXT NOT NULL, tint TEXT NOT NULL);
CREATE TABLE art_uploads (id TEXT NOT NULL, game TEXT NOT NULL, kind TEXT NOT NULL, scope INTEGER NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, focal TEXT NOT NULL DEFAULT '', thumbhash TEXT NOT NULL, tint TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (id, game, kind, scope));
CREATE TABLE games (
    id              TEXT PRIMARY KEY,
    title           TEXT NOT NULL,
    recipe_id       TEXT NOT NULL DEFAULT '',
    version         TEXT NOT NULL DEFAULT '',
    renpy_version   TEXT NOT NULL DEFAULT '',
    engine          TEXT NOT NULL DEFAULT '',
    build           TEXT NOT NULL DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'not_installed',
    size_bytes      INTEGER NOT NULL DEFAULT 0,
    file_count      INTEGER NOT NULL DEFAULT 0,
    screen_w        INTEGER NOT NULL DEFAULT 0,
    screen_h        INTEGER NOT NULL DEFAULT 0,
    save_dir        TEXT NOT NULL DEFAULT '',
    source          TEXT NOT NULL DEFAULT '{}',
    build_options   TEXT NOT NULL DEFAULT '{}',
    walkthrough     TEXT NOT NULL DEFAULT '',
    created_at      TEXT NOT NULL,
    installed_at    TEXT NOT NULL DEFAULT '',
    last_played_at  TEXT NOT NULL DEFAULT '',
    updated_at      TEXT NOT NULL
  , family TEXT NOT NULL DEFAULT 'renpy', engine_label TEXT NOT NULL DEFAULT '', entry TEXT NOT NULL DEFAULT '', favorite_at TEXT NOT NULL DEFAULT '', finished_at TEXT NOT NULL DEFAULT '', play_time INTEGER NOT NULL DEFAULT 0, adult INTEGER NOT NULL DEFAULT 0);
CREATE TABLE identities (provider TEXT NOT NULL, subject TEXT NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id), password TEXT NOT NULL DEFAULT '', PRIMARY KEY(provider, subject));
CREATE TABLE identity_metadata (provider TEXT NOT NULL, subject TEXT NOT NULL, username TEXT NOT NULL, PRIMARY KEY(provider, subject));
CREATE TABLE jobs (
    id          TEXT PRIMARY KEY,
    type        TEXT NOT NULL,
    game        TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL,
    stage       TEXT NOT NULL DEFAULT '',
    progress    REAL NOT NULL DEFAULT 0,
    message     TEXT NOT NULL DEFAULT '',
    params      TEXT NOT NULL DEFAULT '{}',
    result      TEXT NOT NULL DEFAULT '{}',
    error       TEXT NOT NULL DEFAULT '',
    log         TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL,
    started_at  TEXT NOT NULL DEFAULT '',
    finished_at TEXT NOT NULL DEFAULT ''
  );
CREATE TABLE play_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, game TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER NOT NULL, seconds INTEGER NOT NULL);
CREATE TABLE safe_games (game TEXT PRIMARY KEY);
CREATE TABLE save_meta (user_id INTEGER NOT NULL, save_dir TEXT NOT NULL, file TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', pinned_at TEXT NOT NULL DEFAULT '', PRIMARY KEY (user_id, save_dir, file));
CREATE TABLE sessions (hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL, touched_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, label TEXT NOT NULL DEFAULT '');
CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
CREATE TABLE tokens (hash TEXT PRIMARY KEY, id TEXT NOT NULL UNIQUE, user_id INTEGER NOT NULL REFERENCES users(id), name TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE uploaded_archives (path TEXT PRIMARY KEY, identity TEXT NOT NULL);
CREATE TABLE user_games (user_id INTEGER NOT NULL REFERENCES users(id), game TEXT NOT NULL, favorite_at TEXT NOT NULL DEFAULT '', finished_at TEXT NOT NULL DEFAULT '', last_played_at TEXT NOT NULL DEFAULT '', play_time INTEGER NOT NULL DEFAULT 0, play_status TEXT NOT NULL DEFAULT '', rating INTEGER NOT NULL DEFAULT 0, not_now_at TEXT NOT NULL DEFAULT '', PRIMARY KEY(user_id, game));
CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','player')), adult_access INTEGER NOT NULL DEFAULT 0, disabled INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, prefs TEXT NOT NULL DEFAULT '{}', avatar TEXT NOT NULL DEFAULT '', avatar_uploaded INTEGER NOT NULL DEFAULT 0, admin_source TEXT NOT NULL DEFAULT 'manual', admin_provider TEXT NOT NULL DEFAULT '', admin_subject TEXT NOT NULL DEFAULT '', adult_ceiling TEXT NOT NULL DEFAULT '', adult_choice TEXT NOT NULL DEFAULT '');
CREATE TABLE walkthroughs (file TEXT PRIMARY KEY, game TEXT NOT NULL, title TEXT NOT NULL, kind TEXT NOT NULL, size INTEGER NOT NULL DEFAULT 0, added_at TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0);
CREATE INDEX art_made_file1x ON art_made (file1x);
CREATE INDEX art_made_file2x ON art_made (file2x);
CREATE INDEX games_save_dir ON games(save_dir);
CREATE INDEX jobs_status ON jobs(status);
CREATE INDEX play_sessions_user ON play_sessions (user_id, ended_at);
CREATE INDEX walkthroughs_game ON walkthroughs (game, position);
PRAGMA user_version = 16;
