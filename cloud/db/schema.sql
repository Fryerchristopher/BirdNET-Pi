-- BirdNET-Pi Cloud: D1 schema
--
-- Apply with:  wrangler d1 execute birdnet-pi --remote --file=db/schema.sql
-- (and once locally for `wrangler dev`:  wrangler d1 execute birdnet-pi --local --file=db/schema.sql)
--
-- Every statement is idempotent so the file can be re-run safely.

-- ---------------------------------------------------------------------------
-- detections: one row per BirdNET detection, mirrored from the Pi's birds.db.
-- Column names keep the Pi's casing so the push agent can copy rows verbatim.
-- file_name is the Pi's File_Name (basename) and is the natural key.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS detections (
  id          INTEGER PRIMARY KEY,
  station_id  TEXT    NOT NULL DEFAULT 'default',
  date        TEXT    NOT NULL,            -- YYYY-MM-DD, station local time
  time        TEXT    NOT NULL,            -- HH:MM:SS, station local time
  sci_name    TEXT    NOT NULL,
  com_name    TEXT    NOT NULL,
  confidence  REAL    NOT NULL,
  lat         REAL,
  lon         REAL,
  cutoff      REAL,
  week        INTEGER,
  sens        REAL,
  overlap     REAL,
  file_name   TEXT    NOT NULL,            -- basename, e.g. Blue_Jay-87-2025-06-03-birdnet-07:14:22.mp3
  -- derived on insert by the Worker (never by the Pi):
  com_name_safe TEXT  NOT NULL,            -- spaces -> _, apostrophes removed (directory name on the Pi)
  media_key   TEXT    NOT NULL,            -- R2 key of the audio clip: by_date/<date>/<com_name_safe>/<file_name>
  has_audio   INTEGER NOT NULL DEFAULT 0,  -- 1 once the clip is in R2
  has_png     INTEGER NOT NULL DEFAULT 0,  -- 1 once the spectrogram is in R2
  has_shifted INTEGER NOT NULL DEFAULT 0,  -- 1 once a pitch-shifted copy is in R2
  locked      INTEGER NOT NULL DEFAULT 0,  -- excluded from purge on the Pi (mirrors disk_check_exclude.txt)
  on_pi       INTEGER NOT NULL DEFAULT 1,  -- 0 once the Pi reports the local file purged or deleted
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (station_id, file_name)
);
CREATE INDEX IF NOT EXISTS detections_date_time   ON detections (station_id, date DESC, time DESC);
CREATE INDEX IF NOT EXISTS detections_sci_name    ON detections (station_id, sci_name, date);
CREATE INDEX IF NOT EXISTS detections_com_name    ON detections (station_id, com_name);
CREATE INDEX IF NOT EXISTS detections_confidence  ON detections (station_id, sci_name, confidence DESC);

-- ---------------------------------------------------------------------------
-- stations: one row per Pi that pushes here. A single-station install only
-- ever has 'default'. Multi-station is supported by the schema from day one so
-- nobody has to migrate later.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stations (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  timezone      TEXT NOT NULL DEFAULT 'UTC',   -- IANA name, pushed by the Pi
  lat           REAL,
  lon           REAL,
  last_seen_at  TEXT,                          -- last successful push of any kind
  last_detection_at TEXT,
  analyzing_now TEXT,                          -- basename of the wav being analyzed (for "Currently Analyzing")
  pi_version    TEXT,                          -- BirdNET-Pi git commit on the Pi
  agent_version TEXT,
  disk_used_pct REAL,
  backlog_files INTEGER,                       -- files waiting in StreamData
  config_json   TEXT NOT NULL DEFAULT '{}'     -- subset of birdnet.conf the Pi chooses to publish
);
INSERT OR IGNORE INTO stations (id, name) VALUES ('default', 'BirdNET-Pi');

-- ---------------------------------------------------------------------------
-- settings: site-level key/value, editable from the admin UI. Replaces the
-- web-facing half of birdnet.conf. Keys are documented in docs/API.md.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('site_name',             'BirdNET-Pi'),
  ('theme',                 'default'),
  ('image_provider',        'wikipedia'),     -- none | wikipedia | flickr
  ('info_site',             'allaboutbirds'), -- allaboutbirds | ebird
  ('language',              'en'),
  ('rare_species_threshold','30'),            -- days
  ('recording_length',      '15'),            -- seconds, drives refresh timers
  ('stream_url',            ''),              -- optional public URL of a live audio stream (see docs)
  ('flickr_filter_email',   ''),
  ('public_admin_links',    '0'),
  -- Field Journal front end (web-field-journal). Site-specific copy lives here, not in the code.
  ('site_tagline',          'Birds heard from a BirdNET-Pi listening station.'),
  ('footer_blurb',          'a private BirdNET-Pi listening station'),
  ('weather_url',           ''),            -- link shown next to conditions, e.g. https://weather.example.com
  ('weather_label',         'Weather'),
  ('weather_api_url',       '');            -- Dorrington Weather style API base for conditions; empty disables

-- ---------------------------------------------------------------------------
-- species_images: cache of the image provider lookups (was wikipedia.db /
-- flickr.db on the Pi).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS species_images (
  sci_name     TEXT NOT NULL,
  provider     TEXT NOT NULL,                 -- wikipedia | flickr
  com_en_name  TEXT NOT NULL DEFAULT '',
  image_url    TEXT NOT NULL,
  title        TEXT NOT NULL DEFAULT '',
  image_id     TEXT NOT NULL DEFAULT '',
  author_url   TEXT NOT NULL DEFAULT '',
  license_url  TEXT NOT NULL DEFAULT '',
  photos_url   TEXT NOT NULL DEFAULT '',
  author_name  TEXT NOT NULL DEFAULT '',
  license_name TEXT NOT NULL DEFAULT '',
  fetched_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  PRIMARY KEY (sci_name, provider)
);

CREATE TABLE IF NOT EXISTS blacklisted_images (
  image_id   TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ---------------------------------------------------------------------------
-- labels: the model's label list (Sci name + localized common name), pushed
-- by the Pi. Used by the re-identify picker and the species list editors.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS labels (
  station_id TEXT NOT NULL DEFAULT 'default',
  sci_name   TEXT NOT NULL,
  com_name   TEXT NOT NULL,
  com_en_name TEXT,
  PRIMARY KEY (station_id, sci_name)
);

-- ---------------------------------------------------------------------------
-- species_lists: include / exclude / whitelist / confirmed. The cloud copy is
-- authoritative once the agent is installed; the agent writes the Pi's text
-- files from it after every change (see commands).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS species_lists (
  station_id TEXT NOT NULL DEFAULT 'default',
  list       TEXT NOT NULL,                   -- include | exclude | whitelist | confirmed
  sci_name   TEXT NOT NULL,
  com_name   TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (station_id, list, sci_name)
);

-- ---------------------------------------------------------------------------
-- commands: the only way the cloud talks back to the Pi. The Pi is outbound
-- only; the agent long-polls /ingest/commands, executes, then acks.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS commands (
  id          INTEGER PRIMARY KEY,
  station_id  TEXT NOT NULL DEFAULT 'default',
  kind        TEXT NOT NULL,                  -- delete_file | delete_species | reidentify | lock | unlock | shift | unshift | sync_lists | restart_service | run
  payload     TEXT NOT NULL DEFAULT '{}',     -- JSON
  status      TEXT NOT NULL DEFAULT 'pending',-- pending | taken | done | failed
  result      TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  taken_at    TEXT,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS commands_pending ON commands (station_id, status, id);

-- ---------------------------------------------------------------------------
-- daily_charts: optional. If the Pi keeps running chart_viewer.service it can
-- push Combo-<date>.png to R2 and record it here; otherwise the default UI
-- draws the daily chart client-side from /api/v1/daily.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS daily_charts (
  station_id TEXT NOT NULL DEFAULT 'default',
  date       TEXT NOT NULL,
  media_key  TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (station_id, date)
);

-- ---------------------------------------------------------------------------
-- live_analysis: the StreamData *.wav.json sidecar from the Pi, one row per
-- station, overwritten on every push. Feeds the live Spectrogram overlay.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS live_analysis (
  station_id TEXT PRIMARY KEY,
  file_name  TEXT NOT NULL,
  timestamp  TEXT NOT NULL,                   -- ISO8601 from the Pi
  delay      INTEGER NOT NULL,                -- RECORDING_LENGTH
  detections TEXT NOT NULL,                   -- JSON array [{start, common_name, confidence}]
  pushed_at  TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- notification_log: what the Worker sent and why (Apprise-compatible webhooks
-- are configured in settings; the Pi's own Apprise keeps working regardless).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_log (
  id         INTEGER PRIMARY KEY,
  station_id TEXT NOT NULL DEFAULT 'default',
  sci_name   TEXT NOT NULL,
  reason     TEXT NOT NULL,
  sent_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS notification_log_species ON notification_log (station_id, sci_name, sent_at DESC);

-- ---------------------------------------------------------------------------
-- Ask BirdNET-Pi (optional LLM chat). Per-IP rate limiting and a site-wide
-- daily budget that fails closed. Same design as weather.dorringtonbirds.com.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_usage (
  day     TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  hour    INTEGER NOT NULL,
  count   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, ip_hash, hour)
);
CREATE TABLE IF NOT EXISTS chat_budget (
  day         TEXT PRIMARY KEY,
  model_calls INTEGER NOT NULL DEFAULT 0,
  intent_hits INTEGER NOT NULL DEFAULT 0,
  refusals    INTEGER NOT NULL DEFAULT 0,
  blocked     INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('chat_enabled',          '0'),
  ('chat_model',            'claude-haiku-5-5'),
  ('chat_daily_budget',     '300'),
  ('chat_per_ip_per_hour',  '10'),
  ('chat_per_ip_per_day',   '40'),
  ('chat_intro',            'Ask about what the station has heard: species, counts, first arrivals, the best time of day for a bird.');
