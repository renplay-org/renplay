-- The tables of the collector. Safe to apply again: deploy.sh applies it on every deploy.
-- Nothing here holds an IP address, a header or a report. Everything about games is summed per day
-- and game, and never has an instance id.

-- One row per instance: only for counting instances (active, new, versions, setup).
CREATE TABLE IF NOT EXISTS instances (
  id TEXT PRIMARY KEY,
  first_day TEXT NOT NULL,
  last_day TEXT NOT NULL,
  version TEXT NOT NULL,
  arch TEXT,
  install TEXT,
  auth TEXT,
  adult_install TEXT,
  games_gb TEXT,
  data_gb TEXT
);
CREATE INDEX IF NOT EXISTS instances_first_day ON instances (first_day);
CREATE INDEX IF NOT EXISTS instances_last_day ON instances (last_day);

-- One row per instance and day: active instances, retention and versions.
CREATE TABLE IF NOT EXISTS instance_days (
  day TEXT NOT NULL,
  id TEXT NOT NULL,
  version TEXT NOT NULL,
  PRIMARY KEY (day, id)
);
CREATE INDEX IF NOT EXISTS instance_days_id ON instance_days (id, day);

-- Games by catalog recipe id, summed over instances.
CREATE TABLE IF NOT EXISTS game_days (
  day TEXT NOT NULL,
  game TEXT NOT NULL,
  "release" TEXT NOT NULL,
  installed INTEGER NOT NULL DEFAULT 0,
  installs_ok INTEGER NOT NULL DEFAULT 0,
  installs_failed INTEGER NOT NULL DEFAULT 0,
  install_seconds REAL NOT NULL DEFAULT 0,
  plays_sessions INTEGER NOT NULL DEFAULT 0,
  plays_minutes REAL NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, game, "release")
);
CREATE INDEX IF NOT EXISTS game_days_game ON game_days (game, day);

-- Errors by game and kind, with a cleaned first line, summed over instances.
CREATE TABLE IF NOT EXISTS error_days (
  day TEXT NOT NULL,
  game TEXT NOT NULL,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, game, kind, message)
);
CREATE INDEX IF NOT EXISTS error_days_game ON error_days (game, day);

-- The sums of scale, play and features over the instances of a day, by key like play.devices.phone.
-- play.loadSeconds.p50 and .p90 are sums, with play.loadSeconds.count the number of instances in them.
CREATE TABLE IF NOT EXISTS usage_days (
  day TEXT NOT NULL,
  key TEXT NOT NULL,
  value REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (day, key)
);
CREATE INDEX IF NOT EXISTS usage_days_key ON usage_days (key, day);

-- When each instance reported, for the rate limit. Rows live one day.
CREATE TABLE IF NOT EXISTS rate_limits (
  instance TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_limits_instance ON rate_limits (instance, at);
CREATE INDEX IF NOT EXISTS rate_limits_at ON rate_limits (at);
