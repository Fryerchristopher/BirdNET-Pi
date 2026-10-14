# BirdNET-Pi (Nachtzuster fork) Web Layer: Functional Inventory

Purpose: a replication-grade description of every user-facing page, endpoint, query, file-system dependency, and config key in the BirdNET-Pi web UI, written so the UI can be re-implemented on Cloudflare (Workers + D1 + R2) with the Pi reduced to a collector that pushes detections and audio/spectrogram files.

Sources read: the staged files under `/mnt/user-data/uploads/repos/BirdNET-Pi/` (homepage/index.php, homepage/views.php, homepage/style.css, scripts/*.php, scripts/*.sh, scripts/*.py, templates/index_bootstrap.html, README.md). The staged tree does not include `scripts/utils/*.py`, `homepage/static/*.js`, `homepage/static/dark-style.css`, `scripts/install_config.sh`, or the shell helpers the PHP shells out to. Those were fetched from `https://raw.githubusercontent.com/Nachtzuster/BirdNET-Pi/main/` and are marked "(upstream main)" where cited. Upstream main may be slightly newer than the staged copy; where the two differ it is called out.

Conventions in this document:
- `$home` = `/home/<BIRDNET_USER>` (PHP `get_home()`).
- `EXTRACTED` = `$home/BirdSongs/Extracted` (config default). The web root served by Caddy is `EXTRACTED`, and `homepage/*` plus the PHP scripts are symlinked into it, so `/views.php`, `/overview.php`, `/By_Date/...`, `/Charts/...`, `/spectrogram.png`, `/images/...`, `/static/...` all resolve relative to `EXTRACTED`.
- "sanitized common name" or `comname_safe` = common name with every space replaced by `_` and every `'` removed. This is used for directory names and file names everywhere.
- All SQL is SQLite against one table `detections` in `$home/BirdNET-Pi/scripts/birds.db`.

---

## Table of contents

1. Architecture and routing (Caddy, iframes, services)
2. Database schema (createdb.sh) and write path
3. Recording and extraction pipeline: file naming and placement
4. Config: full key list, defaults, where each is read
5. Auth model
6. Shared PHP helpers (common.php): queries, labels, image providers, info links
7. index.php: banner, live audio, filename deep link
8. views.php: nav, update indicator, lat/lon warning, view dispatch, command runner
9. Overview (overview.php)
10. Today's Detections and Kiosk (todays_detections.php)
11. Spectrogram (spectrogram.php)
12. Best Recordings (stats.php, nav label "Best Recordings", view=Species Stats)
13. Species Stats (Streamlit, plotly_streamlit.py, nav label "Species Stats", view=Streamlit)
14. Daily Charts (history.php + daily_plot.py)
15. Weekly Report (weekly_report.php, weekly_report.sh)
16. Recordings (play.php)
17. View Log
18. Tools hub and sub-pages
    18.1 Settings (config.php)
    18.2 Advanced Settings (advanced.php)
    18.3 System Info (phpSysInfo, templates/index_bootstrap.html)
    18.4 System Controls (system_controls.php)
    18.5 Services (service_controls.php)
    18.6 File Manager, Database Maintenance (Adminer), Web Terminal
    18.7 Custom / Excluded / Whitelist species lists (species_list.php)
    18.8 Species Management (species_tools.php)
19. API: /api/v1 (api.php)
20. Shared front-end components: custom audio player, mini graph, attribution dialog
21. Notifications: species_notifier.sh, Apprise, BirdWeather, heartbeat
22. External services summary
23. Style: style.css structure, colors, dark theme deltas
24. Disk management scripts that touch files the UI references
25. Gaps, quirks, and inferred behavior

---

## 1. Architecture and routing

### 1.1 Caddy routes (upstream main, scripts/update_caddyfile.sh)

```
http:// ${BIRDNETPI_URL} {
  root * ${EXTRACTED}
  file_server browse
  handle /By_Date/* { file_server browse }
  handle /Charts/*  { file_server browse }
  basicauth /views.php?view=File* { birdnet ${HASHWORD} }
  basicauth /Processed*           { birdnet ${HASHWORD} }
  basicauth /scripts*             { birdnet ${HASHWORD} }
  basicauth /stream               { birdnet ${HASHWORD} }
  basicauth /phpsysinfo*          { birdnet ${HASHWORD} }
  basicauth /terminal*            { birdnet ${HASHWORD} }
  reverse_proxy /stream   localhost:8000     # icecast2 mp3 stream
  php_fastcgi unix//run/php/php-fpm.sock
  reverse_proxy /log*     localhost:8080     # birdnet_log.service (gotty tail of journal)
  reverse_proxy /stats*   localhost:8501     # Streamlit
  reverse_proxy /terminal* localhost:8888    # gotty web terminal
}
```

When `CADDY_PWD` is empty the basicauth blocks are omitted entirely (everything is open).

Static URL surface a replacement must serve:
- `/` (index.php), `/views.php`, `/overview.php`, `/todays_detections.php`, `/play.php`, `/spectrogram.php`, `/stats.php`, `/history.php`, `/weekly_report.php`, `/scripts/config.php`, `/scripts/advanced.php`, `/scripts/species_tools.php`, `/scripts/backup.php`, `/scripts/restore.php`, `/scripts/adminer.php`, `/scripts/filemanager/filemanager.php`
- `/By_Date/<YYYY-MM-DD>/<comname_safe>/<File_Name>` (audio) and `...<File_Name>.png` (spectrogram)
- `/By_Date/shifted/<YYYY-MM-DD>/<comname_safe>/<File_Name>` (pitch-shifted copies)
- `/Charts/Combo-<YYYY-MM-DD>.png` (and `Combo2-...` which this fork no longer generates)
- `/spectrogram.png` (live "currently analyzing" spectrogram, regenerated continuously)
- `/images/*` (bird.png, bnp.png, menu.png, copy.png, info.png, wiki.png, chart.svg, delete.svg, bird.svg, lock.svg, unlock.svg, shift.svg, unshift.svg, spinner.gif, sort_abc.svg, sort_occ.svg, sort_conf.svg, sort_date.svg, check.svg, BirdNET-Pi_nm_flowchart.alpha.png)
- `/static/*` (style/dark-style.css, dialog-polyfill.css/js, Chart.bundle.js, chartjs-plugin-trendline.min.js, custom-audio-player.js, generateMiniGraph.js, plupload.full.min.js, RobotoFlex-Regular.ttf)
- `/stream`, `/log`, `/stats`, `/terminal`, `/phpsysinfo/`
- `/api/v1/image/<sci_name>`

### 1.2 Page composition

`index.php` is the outer shell (banner + Live Audio button) and embeds `views.php` in a full-width `<iframe>`. `views.php` renders the top nav and includes the selected view's PHP inline. Some views are themselves iframes inside views.php (System Info, View Log, Streamlit, File Manager, Adminer, Web Terminal). Several views also serve AJAX fragments when called directly with query flags (overview.php, todays_detections.php, play.php, spectrogram.php, config.php, species_tools.php, history.php).

### 1.3 systemd services the UI references

livestream.service (ffmpeg -> icecast2 at :8000/stream), icecast2.service, web_terminal.service (gotty :8888), birdnet_log.service (:8080), birdnet_analysis.service, birdnet_stats.service (Streamlit :8501), birdnet_recording.service, chart_viewer.service (daily_plot.py daemon), spectrogram_viewer.service (spectrogram.sh), plus a tmpfs mount unit for `$home/BirdSongs/StreamData` (name from `systemd-escape -p --suffix=mount`).

---

## 2. Database schema and write path

### 2.1 scripts/createdb.sh (verbatim)

```sql
DROP TABLE IF EXISTS detections;
CREATE TABLE IF NOT EXISTS detections (
  Date DATE,
  Time TIME,
  Sci_Name VARCHAR(100) NOT NULL,
  Com_Name VARCHAR(100) NOT NULL,
  Confidence FLOAT,
  Lat FLOAT,
  Lon FLOAT,
  Cutoff FLOAT,
  Week INT,
  Sens FLOAT,
  Overlap FLOAT,
  File_Name VARCHAR(100) NOT NULL);
CREATE INDEX "detections_Com_Name" ON "detections" ("Com_Name");
CREATE INDEX "detections_Sci_Name" ON "detections" ("Sci_Name");
CREATE INDEX "detections_Date_Time" ON "detections" ("Date" DESC, "Time" DESC);
```

There is no primary key and no rowid alias. Rows are identified in the UI by `File_Name` (unique in practice because it embeds species, confidence, date, and time to the second).

Column semantics (from utils/reporting.py `write_to_db`, upstream main):
- `Date`: `YYYY-MM-DD` string, local time of the detection start (file timestamp + chunk start offset).
- `Time`: `HH:MM:SS` string, local time.
- `Sci_Name`: scientific name as in the model label file (e.g. `Cyanocitta cristata`).
- `Com_Name`: localized common name from `model/l18n/labels_<DATABASE_LANG>.json` (may contain apostrophes and spaces).
- `Confidence`: float rounded to 4 decimals (0..1). Set to `0` when a detection is manually re-identified (see 16.4).
- `Lat`, `Lon`: config LATITUDE/LONGITUDE at insert time (strings in config, stored as REAL).
- `Cutoff`: config CONFIDENCE at insert time.
- `Week`: ISO week number of the detection datetime (stored as string of int).
- `Sens`: config SENSITIVITY. `Overlap`: config OVERLAP.
- `File_Name`: basename only of the extracted clip (no directory). See section 3.

Insert statement (upstream main reporting.py):
```python
cur.execute("INSERT INTO detections VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (detection.date, detection.time, detection.scientific_name, detection.common_name, detection.confidence,
             conf['LATITUDE'], conf['LONGITUDE'], conf['CONFIDENCE'], str(detection.week), conf['SENSITIVITY'],
             conf['OVERLAP'], os.path.basename(detection.file_name_extr)))
```
Retried up to 3 times with 2 s sleep on "database busy".

A flat log is also appended: `$home/BirdNET-Pi/BirdDB.txt`, one line per detection: `Date;Time;Sci_Name;Com_Name;Confidence;Lat;Lon;Cutoff;Week;Sens;Overlap` (header line written by clear_all_data.sh).

### 2.2 Secondary SQLite files

- `scripts/flickr.db` (table `images`, table `source`) and `scripts/wikipedia.db` (table `images`): image cache, see 6.5.
- `IdentifiedSoFar.txt` (`IDFILE`): sorted list of DISTINCT Com_Name, used by species_notifier.sh.

---

## 3. Recording and extraction pipeline: file naming and placement

### 3.1 Raw recordings (birdnet_recording.sh, upstream main)

- Sound card: `arecord -f S16_LE -c${CHANNELS} -r48000 -t wav --max-file-time ${RECORDING_LENGTH} --use-strftime ${RECS_DIR}/StreamData/%F-birdnet-%H:%M:%S.wav`
  File name pattern: `YYYY-MM-DD-birdnet-HH:MM:SS.wav`
- RTSP: ffmpeg segmenter, one process per stream, N starting at 1:
  `${RECS_DIR}/StreamData/%F-birdnet-RTSP_${N}-%H:%M:%S.wav`
  File name pattern: `YYYY-MM-DD-birdnet-RTSP_<N>-HH:MM:SS.wav`

`ParseFileName` (utils/classes.py) parses `^[0-9]+-[0-9]+-[0-9]+` as the date and `[0-9]+:[0-9]+:[0-9]+$` as the time from the basename, and captures `RTSP_[0-9]+-` (including trailing dash) as `RTSP_id` (empty string when absent).

### 3.2 Analysis (birdnet_analysis.py + utils/analysis.py)

- Watches `RECS_DIR/StreamData` with inotify IN_CLOSE_WRITE; processes backlog first (`get_wav_files()` = `RECS_DIR/*/*/*.wav` + `RECS_DIR/StreamData/*.wav`, sorted, minus files currently open per `lsof`).
- Writes the path of the file being analyzed to `$home/BirdSongs/StreamData/analyzing_now.txt` (`ANALYZING_NOW`). spectrogram.sh watches this file and regenerates `EXTRACTED/spectrogram.png` at most every `RECORDING_LENGTH*2/3` seconds.
- Audio is split into 3 s chunks with `OVERLAP` seconds overlap. Each chunk's top-10 predictions are kept; a chunk is blanked to `Human_Human` if "Human" appears within the top `max(10, int(6000 * PRIVACY_THRESHOLD / 100))` predictions, and neighbors of a human chunk are also blanked.
- A `Detection` is created for every (chunk, species) with confidence >= `CONFIDENCE`, subject to:
  - include list non-empty and species not in it: dropped
  - species in exclude list: dropped
  - species not in the location/week species list (SF_THRESH) and not in whitelist: dropped
  Lists are read as the part before `_` of each line (i.e. the scientific name). Upstream main reads them from `~/BirdNET-Pi/{include,exclude,whitelist}_species_list.txt`; the PHP writes `./scripts/<name>_species_list.txt`, which is a symlink to the same files (clear_all_data.sh creates the symlinks).
- Each `Detection` has: `start`, `stop` (seconds into the file), `datetime = file_date + start`, `date` (`%Y-%m-%d`), `time` (`%H:%M:%S`), `iso8601` (local tz), `week` (ISO), `confidence` (round 4), `confidence_pct` (`round(conf*100)` integer), `scientific_name`, `common_name`, `common_name_safe` (`replace("'", "").replace(" ", "_")`).

### 3.3 Extraction (utils/reporting.py `extract_detection`)

```python
new_file_name = f'{detection.common_name_safe}-{detection.confidence_pct}-{detection.date}-birdnet-{file.RTSP_id}{detection.time}.{conf["AUDIOFMT"]}'
new_dir = os.path.join(conf['EXTRACTED'], 'By_Date', f'{detection.date}', f'{detection.common_name_safe}')
```

So `File_Name` in the DB is exactly:

```
<Com_Name_safe>-<confidence_pct>-<YYYY-MM-DD>-birdnet-[RTSP_<N>-]<HH:MM:SS>.<AUDIOFMT>
```

Examples: `Blue_Jay-87-2025-06-03-birdnet-07:14:22.mp3`, `Mésange_charbonnière-78-2024-05-02-birdnet-RTSP_1-18:14:08.mp3`.

Full path: `EXTRACTED/By_Date/<YYYY-MM-DD>/<Com_Name_safe>/<File_Name>`. Web path: `/By_Date/<YYYY-MM-DD>/<Com_Name_safe>/<File_Name>`.

Clip audio: `sox in out trim =safe_start =safe_stop` where `spacer = (EXTRACTION_LENGTH - 3)/2` (EXTRACTION_LENGTH defaults to 6 when empty), `safe_start = max(0, start - spacer)`, `safe_stop = min(RECORDING_LENGTH, stop + spacer)`. If the target file already exists the extraction is skipped (log warning) but the DB row is still written.

Spectrogram PNG: generated right after extraction by `sox <clip> -n remix 1 rate 24k spectrogram -t '' -c '' -o tmp.png [-r]` (`-r` = raw, no axes, when `RAW_SPECTROGRAM=1`), then PIL overlays the common name centered at top (13 px, white) and the clip path relative to `~/` at bottom-left (11 px, white), and saves to `<clip path>.png`. So the PNG name is always `<File_Name>.png` alongside the audio.

JSON sidecar: `<StreamData wav>.json` with `{"file_name": "<basename>.json", "timestamp": <file iso8601>, "delay": RECORDING_LENGTH, "detections": [{"start": float, "common_name": str, "confidence": float}, ...]}`. Older `*.json` (for the same RTSP_id when set) in StreamData are deleted before writing. The live Spectrogram page polls these.

After reporting, the raw wav is deleted (`os.remove(file.file_name)`). The `PROCESSED` directory is legacy and not populated by this fork's pipeline.

### 3.4 Charts

`daily_plot.py` (chart_viewer.service, daemon, every 2 min) writes `~/BirdSongs/Extracted/Charts/Combo-<YYYY-MM-DD>.png`. Detail in section 14.

### 3.5 Live spectrogram

`spectrogram.sh` writes `EXTRACTED/spectrogram.png` using `sox "<analyzing_now>" -n remix 1 rate 24k spectrogram -c "<path relative to $HOME>" -o spectrogram.png [-r]`.

---

## 4. Config: full key list with defaults

Source of defaults: upstream main `scripts/install_config.sh` (writes `$home/BirdNET-Pi/birdnet.conf`, symlinked to `/etc/birdnet/birdnet.conf`). PHP parses it with `parse_ini_string` after stripping `#` comment lines; values may be quoted. Python strips surrounding double quotes.

| Key | Default | Set by | Read by (web layer) |
|---|---|---|---|
| SITE_NAME | `"$HOSTNAME"` | Settings | index.php, todays_detections.php (kiosk header), get_sitename() falls back to "BirdNET-Pi" when empty |
| LATITUDE | geo-IP or `0.0000` | Settings | views.php warning, history.php eBird CSV, species.py, daily analysis, Streamlit sunrise |
| LONGITUDE | geo-IP or `0.0000` | Settings | same |
| MODEL | `BirdNET_GLOBAL_6K_V2.4_Model_FP16` | Settings | config.php (select), bird_weather algorithm tag |
| SF_THRESH | `0.03` | Settings | config.php, species_tools.php (probability coloring) |
| DATA_MODEL_VERSION | `1` | Settings checkbox (checked => 2) | config.php, species.py |
| BIRDWEATHER_ID | empty | Settings | reporting.py bird_weather |
| CADDY_PWD | empty | Advanced | is_authenticated(); update_caddyfile.sh |
| ICE_PWD | `birdnetpi` | Advanced | livestream.sh |
| BIRDNETPI_URL | empty | Advanced | Caddyfile, notifications $listenurl |
| RTSP_STREAM | empty (comma separated list) | Advanced | spectrogram.php dropdown, recording, livestream |
| RTSP_STREAM_TO_LIVESTREAM | `"0"` (0-based index) | Advanced, Spectrogram dropdown | spectrogram.php, livestream.sh |
| ACTIVATE_FREQSHIFT_IN_LIVESTREAM | not in template (treated as unset/false) | Spectrogram checkbox via Advanced submit | spectrogram.php, livestream.sh |
| APPRISE_NOTIFICATION_TITLE | `"New BirdNET-Pi Detection"` | Settings | notifications.py |
| APPRISE_NOTIFY_EACH_DETECTION | `0` | Settings | notifications.py |
| APPRISE_NOTIFY_NEW_SPECIES | `0` | Settings | notifications.py (<=5 in last 7 days) |
| APPRISE_WEEKLY_REPORT | `1` | Settings | weekly_report.sh |
| APPRISE_NOTIFY_NEW_SPECIES_EACH_DAY | `0` | Settings | notifications.py |
| APPRISE_MINIMUM_SECONDS_BETWEEN_NOTIFICATIONS_PER_SPECIES | `0` | Settings ("minimum_time_limit") | notifications.py |
| APPRISE_ONLY_NOTIFY_SPECIES_NAMES | `""` | Settings (label says "Exclude these species") | notifications.py exclusion list |
| APPRISE_ONLY_NOTIFY_SPECIES_NAMES_2 | `""` | Settings ("ONLY notify for these") | notifications.py inclusion list |
| IMAGE_PROVIDER | `WIKIPEDIA` | Settings (`""`, `WIKIPEDIA`, `FLICKR`) | overview, todays_detections, api.php |
| FLICKR_API_KEY | empty | Settings | Flickr class, stats.php gallery |
| FLICKR_FILTER_EMAIL | empty | Settings | Flickr class (restrict to one user) |
| INFO_SITE | `"ALLABOUTBIRDS"` | Settings (`ALLABOUTBIRDS` or `EBIRD`) | get_info_url() |
| COLOR_SCHEME | `"light"` | Settings (`light`/`dark`) | get_color_scheme(), daily_plot.py palette, phpsysinfo template |
| FULL_DISK | `purge` | Advanced (`purge`/`keep`) | disk_check.sh |
| PURGE_THRESHOLD | `95` | Advanced | disk_check.sh |
| MAX_FILES_SPECIES | `0` | Advanced | disk management (per-species cap, not in the staged scripts) |
| BIRDNET_USER | `$USER` | installer | get_user()/get_home() |
| RECS_DIR | `$HOME/BirdSongs` | installer | spectrogram.php (StreamData path), analysis |
| REC_CARD | `default` | Advanced | recording, livestream |
| PROCESSED | `$HOME/BirdSongs/Processed` | installer | disk_check.sh |
| EXTRACTED | `$HOME/BirdSongs/Extracted` | installer | extraction, Caddy root |
| OVERLAP | `0.0` | Advanced | analysis, stored per row |
| CONFIDENCE | `0.7` | Advanced | analysis cutoff, stored per row |
| SENSITIVITY | `1.25` | Advanced | model sigmoid, stored per row |
| FREQSHIFT_TOOL | `sox` | Advanced (`sox`/`ffmpeg`) | play.php shiftfile |
| FREQSHIFT_HI | `6000` | Advanced | play.php (ffmpeg rubberband pitch=LO/HI), livestream |
| FREQSHIFT_LO | `3000` | Advanced | same |
| FREQSHIFT_RECONNECT_DELAY | `4000` (ms) | Advanced | spectrogram.php JS |
| FREQSHIFT_PITCH | `-1500` (cents) | Advanced | play.php (sox pitch) |
| CHANNELS | `2` | Advanced | recording, livestream |
| PRIVACY_THRESHOLD | `0` (0..3, percent) | Advanced slider | analysis filter_humans |
| RECORDING_LENGTH | `15` | Advanced | overview refresh timers, spectrogram refresh, extraction clamp |
| EXTRACTION_LENGTH | empty (=6) | Advanced | extraction spacer |
| AUDIOFMT | `mp3` | Advanced | extraction file extension |
| DATABASE_LANG | `en` | Settings ("language") | labels, eBird siteLanguage, fonts |
| HEARTBEAT_URL | empty | not in UI | reporting.heartbeat |
| SILENCE_UPDATE_INDICATOR | `0` | Advanced | views.php Tools badge |
| AUTOMATIC_UPDATE | `0` | Advanced | cron (not web) |
| RAW_SPECTROGRAM | `0` | Advanced | spectrogram generation (`-r`) |
| CUSTOM_IMAGE | empty (absolute path) | Advanced | overview.php custom image |
| CUSTOM_IMAGE_TITLE | `""` | Advanced ("custom_image_label") | overview.php |
| RARE_SPECIES_THRESHOLD | `30` (days) | Advanced | overview.php rare species |
| LAST_RUN, THIS_RUN | empty | debug | unused by UI |
| IDFILE | `$HOME/BirdNET-Pi/IdentifiedSoFar.txt` | installer | species_notifier.sh, update_species.sh |
| LogLevel_BirdnetRecordingService | `"error"` | Advanced | birdnet_recording.sh |
| LogLevel_LiveAudioStreamService | `"error"` | Advanced | livestream.sh |
| LogLevel_SpectrogramViewerService | `"error"` | Advanced | spectrogram.sh |

Config file write pattern: every settings page does `preg_replace("/KEY=.*/", "KEY=value", $contents)` on the whole file, then `fopen(.., "w")`. Keys missing from the file are therefore never added (e.g. ACTIVATE_FREQSHIFT_IN_LIVESTREAM must already exist). PHP caches the parsed config in `$_SESSION['my_config']` keyed on the file mtime.

Other files in `$home/BirdNET-Pi/`:
- `apprise.txt`: Apprise URL list (one per line), written by Settings.
- `body.txt`: notification body template, default `A $comname ($sciname)  was just detected with a confidence of $confidence ($reason)`.
- `scripts/labels.txt` (symlink to `model/labels.txt`): one `Sci name_Common name` per line in DATABASE_LANG; used for the species list pickers and re-identification dropdown.
- `scripts/include_species_list.txt`, `scripts/exclude_species_list.txt`, `scripts/whitelist_species_list.txt`: lines in `Sci name_Common name` form (from labels.txt options). Species Management also writes bare scientific names into `confirmed_species_list.txt`.
- `scripts/confirmed_species_list.txt`: bare scientific names, one per line.
- `scripts/disk_check_exclude.txt`: purge-protection list; format is `##start`, then auto lines, `##end`, then manual lines (see 12.5 and 16.3).
- `scripts/blacklisted_images.txt`: Flickr photo ids, one per line.
- `model/l18n/labels_en.json`: `{sci_name: english common name}` used by `get_com_en_name()`.

---

## 5. Auth model

- HTTP Basic auth, single user `birdnet`, password = `CADDY_PWD` plaintext. Caddy enforces it at the edge on the paths listed in 1.1; PHP additionally checks `$_SERVER['PHP_AUTH_USER'] == 'birdnet' && PHP_AUTH_PW == CADDY_PWD` via `is_authenticated()` and `ensure_authenticated($msg)` (sends `WWW-Authenticate: Basic realm="My Realm"`, 401, prints a one-cell table with the message, exits).
- Views requiring login (PHP-side `ensure_authenticated`): `Tools` hub, `System Controls`, `Services`, `Settings` (config.php), `Advanced`, `Included`, `Excluded`, `Whitelisted`, `Species Management`, `Webterm`, any `?submit=` command, `index.php?stream` (Live Audio), `overview.php?blacklistimage`, `play.php?deletefile`, `play.php?excludefile`, `play.php?changefile`, `play.php?shiftfile`, `scripts/backup.php`, `scripts/restore.php`, `species_tools.php` (all endpoints), `config.php` (all endpoints incl. `?threshold`, `?sendtest`, `?restart_php`).
- Caddy-only protection (no PHP check): `/scripts*` (covers adminer.php and filemanager), `/phpsysinfo*`, `/terminal*`, `/Processed*`, `/stream`.
- Public: Overview, Today's Detections, Kiosk, Spectrogram page (but its audio element loads `/stream`, which needs auth), Best Recordings, Streamlit, Daily Charts (and eBird CSV), Weekly Report, Recordings listing/playing, View Log, `/By_Date/*`, `/Charts/*`, `/api/v1/image/*`, `todays_detections.php?comname=` mini-graph JSON, `play.php?getlabels`.
- The `git status` update check in views.php only runs when authenticated, once per 24 h per session.

---

## 6. Shared PHP helpers (scripts/common.php)

### 6.1 Session and environment
- `set_timezone()`: caches `timedatectl show --value --property=Timezone` in session and calls `date_default_timezone_set`. All `date()` and `DATE('now','localtime')` logic assumes Pi local time.
- `get_db()`: `new SQLite3('./scripts/birds.db', SQLITE3_OPEN_READONLY)`, busyTimeout 1000 ms. `ensure_db_ok($stmt)`: on prepare failure prints "Database is busy", sends `refresh:1` header, exits. The JS on every page checks response text for "Database is busy" and ignores such fragments.

### 6.2 fetch_species_array($sort_by, $date=null)
One row per species (GROUP BY Sci_Name), optional date filter `WHERE Date == "<date>"`:

```sql
-- occurrences
SELECT Date, Time, File_Name, Com_Name, Sci_Name, COUNT(*) as Count, MAX(Confidence) as MaxConfidence FROM detections $where GROUP BY Sci_Name ORDER BY COUNT(*) DESC
-- confidence
SELECT ... FROM detections $where GROUP BY Sci_Name ORDER BY MAX(Confidence) DESC
-- date
SELECT ... FROM detections $where GROUP BY Sci_Name ORDER BY MIN(Date) DESC, Time DESC
-- default (alphabetical or unset)
SELECT ... FROM detections $where GROUP BY Sci_Name ORDER BY Com_Name ASC
```

Important SQLite semantic: with `MAX(Confidence)` present in the select list, SQLite's bare-column rule makes `Date`, `Time`, `File_Name`, `Com_Name` come from the row holding the max confidence. So every "species" row carries the best recording's Date/Time/File_Name. This is what "Best Recording" on stats.php relies on. (When both COUNT and MAX appear, SQLite picks the row of the MAX aggregate.) A D1 port must replicate this with an explicit "best row per species" subquery.

### 6.3 fetch_best_detection($com_name)
```sql
SELECT Com_Name, Sci_Name, COUNT(*), MAX(Confidence), File_Name, Date, Time from detections WHERE Com_Name = "<com_name>"
```
Single row; same bare-column semantics (File_Name/Date/Time of the max-confidence row).

### 6.4 fetch_all_detections($sci_name, $sort_by, $date=null)
```sql
-- occurrences (note: ORDER BY COUNT(*) on a non-grouped query; effectively arbitrary order)
SELECT * FROM detections WHERE Sci_Name == "<sci>" [AND Date == "<date>"] ORDER BY COUNT(*) DESC
-- confidence
SELECT * FROM detections WHERE Sci_Name == "<sci>" [AND Date == "<date>"] ORDER BY Confidence DESC
-- default / date
SELECT * FROM detections where Sci_Name == "<sci>" [AND Date == "<date>"] ORDER BY Date DESC, Time DESC   -- or ORDER BY Time DESC when a date is given
```

### 6.5 get_summary()
```sql
SELECT COUNT(*) FROM detections
SELECT COUNT(*) FROM detections WHERE Date == DATE('now', 'localtime')
SELECT COUNT(*) FROM detections WHERE Date == Date('now', 'localtime') AND TIME >= TIME('now', 'localtime', '-1 hour')
SELECT COUNT(DISTINCT(Sci_Name)) FROM detections WHERE Date == Date('now','localtime')
SELECT COUNT(DISTINCT(Sci_Name)) FROM detections
```
Returns `totalcount`, `todaycount`, `hourcount`, `speciestally` (today), `totalspeciestally`.

### 6.6 get_label($record, $sort_by, $date)
Button label for species lists:
- confidence: `Com_Name (NN%)` with `round(MaxConfidence*100)`
- occurrences: `Com_Name (N)` or `Com_Name (N.Nk)` when >= 1000 (`round(n/1000,1)`)
- date and no date filter: `Com_Name (YYYY-MM-DD)`; date with a date filter: `Com_Name (HH:MM:SS)`
- otherwise: `Com_Name`

### 6.7 get_com_en_name($sci_name)
Looks up `model/l18n/labels_en.json[$sci_name]` for the English name (used for Flickr search text and All About Birds URL).

### 6.8 get_info_url($sciname)
- `INFO_SITE === 'EBIRD'`: `https://ebird.org/species/<code>?siteLanguage=<DATABASE_LANG>` where code comes from `scripts/ebird.php` `$ebirds[sci_name]` (a 6,500-line PHP array mapping scientific name to eBird species code). Title "eBirds".
- else: `https://allaboutbirds.org/guide/<English name with spaces->_ and apostrophes removed>`. Title "All About Birds".

### 6.9 get_color_scheme()
`COLOR_SCHEME` lower-cased equals `dark` -> `static/dark-style.css`, else `style.css`. Stylesheet link is cache-busted with `?v=<mtime n.d.y>`.

### 6.10 ImageProvider classes

Shared cache schema (created on first use if the sqlite file cannot be opened):
```sql
CREATE TABLE images (sci_name VARCHAR(63) NOT NULL PRIMARY KEY, com_en_name VARCHAR(63) NOT NULL, image_url TEXT NOT NULL, title TEXT NOT NULL, id TEXT NOT NULL UNIQUE, author_url TEXT NOT NULL, license_url TEXT NOT NULL, date_created DATE)
CREATE TABLE source (ID INTEGER PRIMARY KEY, email VARCHAR(63), uid VARCHAR(63), date_created DATE)
```
Lookup: `SELECT sci_name, com_en_name, image_url, title, id, author_url, license_url, date_created FROM images WHERE sci_name == :sci_name`. Insert: `INSERT OR REPLACE INTO images VALUES (..., DATE("now"))`. Base `get_image()` expires a cached row after a random 15..25 days and refetches.

Wikipedia (`scripts/wikipedia.db`):
1. `GET https://en.wikipedia.org/api/rest_v1/page/summary/<Sci_Name with spaces->_>` (User-Agent: BirdNET-Pi). Requires `originalimage`.
2. image_name = last path segment of `originalimage.source`.
3. `GET https://commons.wikimedia.org/w/api.php?action=query&titles=File:<image_name>&prop=imageinfo&iiprop=extmetadata|size&format=json`.
4. author_url = first `href="http..."` inside `extmetadata.Artist.value`, else the file page `https://en.wikipedia.org/wiki/File:<image_name>`; license_url = `extmetadata.LicenseUrl.value` else file page.
5. If width > 1280, image_url is rewritten to the thumb: replace `/commons/` with `/commons/thumb/` and append `/1280px-<image_name>`.
6. Stored with `id = sci_name`, `title = page title`. `photos_url` returned to callers = `https://en.wikipedia.org/wiki/File:<image_name>` (handles the thumb path by taking the second-to-last segment).

Flickr (`scripts/flickr.db`):
- Constructor loads `scripts/blacklisted_images.txt` (photo ids). If `source.email` differs from `FLICKR_FILTER_EMAIL`, drops and recreates `images`, and resolves the user's NSID via `flickr.people.findByEmail` (stored in `source`). With an email set, searches are limited to `&user_id=<nsid>` and the query omits the " bird" suffix.
- Search: `https://www.flickr.com/services/rest/?method=flickr.photos.search&api_key=KEY&text=<English name, spaces as %20>%20bird&sort=relevance&license=2,3,4,5,6,9&orientation=square,portrait&per_page=5&media=photos&format=json&nojsoncallback=1`. First photo whose id is not `4892923285` and not blacklisted is used.
- License: `flickr.photos.getInfo` for the photo's license id, mapped through a cached `flickr.photos.licenses.getInfo` table to a URL.
- image_url = `https://farm<farm>.static.flickr.com/<server>/<id>_<secret>.jpg`; author_url = `https://flickr.com/people/<owner>`; `photos_url` = author_url with `/people/` -> `/photos/` plus `/<id>`.
- `get_image()` deletes and refetches when the cached id is now blacklisted.

Pages cache the resolved image tuple per page-session in `$_SESSION['images']` as `[comname_safe, image_url, title, photos_url, author_url, license_url]`, keyed by sanitized common name, and reset the cache whenever a provider reports `is_reset()`.

---

## 7. index.php (outer shell)

Query parameters:
- `stream` (any value): requires auth; replaces the "Live Audio" button with `<audio controls autoplay><source src="/stream"></audio>`.
- `filename=<File_Name>`: embeds `views.php?view=Recordings&filename=<File_Name>` instead of the default `views.php`. This is the "Open in new tab" deep link used throughout and the `$listenurl` in notifications.
- `logo` (any value): renders the logo at 60x60 inline style (otherwise default size).
- `/api/v1/*` paths are routed to `scripts/api.php` before anything else.

Layout: `<div class="banner">` containing `.logo` (bird.png linking to the GitHub repo, new tab), `.stream` (form GET `index.php` with `<button name="stream" value="play">Live Audio</button>`, or the audio element), `<h1><a href="/"><img class="topimage" src="images/bnp.png"></a></h1>`, then `<div class="centered"><h3>SITE_NAME</h3></div>`, then the iframe. Favicon `images/bird.png`. Title = SITE_NAME.

---

## 8. views.php (nav shell and dispatcher)

### 8.1 Pre-render logic
- Sanitizes `$_GET`/`$_POST` with `FILTER_SANITIZE_STRING` (so `'` arrives as `&#39;`; pages call `htmlspecialchars_decode(..., ENT_QUOTES)` before using species names in SQL or file paths).
- If authenticated and the session's `behind` value is older than 86400 s: runs `git fetch` in background and parses `git status` for `behind '...' by N commit(s)`, `N and M different commits each` (sum), or "Your branch is up to date" (0). Stores `$_SESSION['behind']`.
- If `behind >= 99`, widens `.updatenumber` to 30 px.
- Prints a red centered warning when LATITUDE and/or LONGITUDE equal `0.000`: "WARNING: Your latitude and longitude are not set properly. Please do so now in Tools -> Settings." (variants for only lat or only lon).

### 8.2 Top nav (`form#views`, GET to views.php, `div.topnav#myTopnav`)
Buttons (name=view): `Overview`, `Todays Detections` (label "Today's Detections"), `Spectrogram`, `Species Stats` (label "Best Recordings"), `Streamlit` (label "Species Stats"), `Daily Charts`, `Weekly Report`, `Recordings`, `View Log`, `Tools` (label "Tools" + red badge `div.updatenumber` with the behind count when `behind >= 50` and `SILENCE_UPDATE_INDICATOR != 1`). Plus a hamburger `button.icon` (menu.png) that toggles `.responsive` on narrow screens. JS adds `.button-hover` to the button whose value equals the last `=`-separated segment of the query string (or the first button when no query). Clicking any nav button fades `.views` to 0.5 opacity until the page reloads.

Note the swapped labels: nav "Best Recordings" -> `view=Species Stats` -> stats.php; nav "Species Stats" -> `view=Streamlit` -> Streamlit iframe.

### 8.3 Dispatch table (`?view=`)
| view value | Behavior | Auth |
|---|---|---|
| (none) | include overview.php | no |
| Overview | include overview.php | no |
| Todays Detections | include todays_detections.php | no |
| Kiosk | `$kiosk=true`; include todays_detections.php | no |
| Spectrogram | include spectrogram.php | no (stream needs auth) |
| Species Stats | include stats.php | no |
| Streamlit | `<iframe src="stats">` | no |
| Daily Charts | include history.php | no |
| Weekly Report | include weekly_report.php | no |
| Recordings | include play.php | no (mutations need auth) |
| View Log | `<iframe style="width:calc(100% + 1em)" src="log">` | no |
| Tools | tools hub (see 18) | yes |
| Settings | include scripts/config.php | yes (inside) |
| Advanced | include scripts/advanced.php | yes (inside) |
| System Info | `<iframe src='phpsysinfo/index.php'>` | Caddy |
| System Controls | include scripts/system_controls.php | yes |
| Services | include scripts/service_controls.php | yes |
| File | `<iframe src='scripts/filemanager/filemanager.php'>` | Caddy |
| Adminer | `<iframe src='scripts/adminer.php'>` | Caddy |
| Webterm | `<iframe src='terminal'>` | yes |
| Included / Excluded / Whitelisted | optional list mutation, then include scripts/species_list.php | yes |
| Species Management | include scripts/species_tools.php | yes |

### 8.4 Species list mutation (`view=Included|Excluded|Whitelisted` with `species[]` and `add` or `del`)
`update_species_list($file, $species, $add)`:
- add: collapse blank lines, then append each selected option (HTML-decoded) that is not already a substring of the file, one per line.
- del: for each selected option, `str_replace` it (both raw and decoded) with empty string, then strip blank lines.
Files: `./scripts/include_species_list.txt`, `./scripts/exclude_species_list.txt`, `./scripts/whitelist_species_list.txt`.

### 8.5 Command runner (`?submit=<command>`, no `view`)
Requires auth. Only exact strings in `$allowedCommands` run (listed in service_controls/system_controls sections; also `stop_core_services.sh`, `restart_services.sh`, `sudo reboot`, `update_birdnet.sh`, `sudo shutdown now`, `sudo clear_all_data.sh`, `cat $home/BirdSongs/restore.log`). For `systemctl` commands, it appends ` & sleep 3;sudo systemctl status <service names>` (service names extracted as the last token of each `&&`-separated part). `update_birdnet.sh` clears the session. Output is HTML-highlighted: `FAILURE`/`failed` red, `active (running)` green bold, `Your branch is up to date` limegreen, `(+)`/`(-)` colored, and git `--stat` lines reformatted with colored `+`/`-`. `<script>` tags stripped. Empty output becomes "This command has no output." Rendered as a table: header "Output of command:`<cmd>`" with a Copy button (copies the first `<pre>`), body `<pre class="bash">`.

### 8.6 Page-level JS in views.php
- `setLiveStreamVolume(vol)`: sets volume on every `.custom-audio-player audio` (used by `<video>` elements on stats.php to duck live audio: `onplay=setLiveStreamVolume(0)`, `onended/onpause=setLiveStreamVolume(1)`). `onbeforeunload` restores volume 1.
- Daily Charts keyboard/swipe: when the active nav button is "Daily Charts", Left/Right arrow keys and horizontal swipes (>20 px, <350 ms) navigate to `/views.php?date=<theDate +/- 1 day>&view=Daily+Charts`, showing `#SwipeSpinner` first. `$theDate` is injected from history.php.
- `myFunction()`: toggles the responsive nav.

---

## 9. Overview (scripts/overview.php)

Public. Included by views.php for `view=Overview` or no view. Also an AJAX endpoint when called directly.

### 9.1 AJAX endpoints (query flags; each `die()`s after output)

`?custom_image=true`: if `CUSTOM_IMAGE` set, outputs `<br><h3>CUSTOM_IMAGE_TITLE</h3><img src='data:image/png;base64,...'>` reading the file at the absolute path in CUSTOM_IMAGE. Polled every 1 s when `strlen(CUSTOM_IMAGE) > 2`.

`?blacklistimage=<flickr photo id>`: auth required. Appends the id + newline to `$home/BirdNET-Pi/scripts/blacklisted_images.txt`, clears `$_SESSION['images']`, prints `OK`.

`?fetch_chart_string=true`: prints `Combo-<today>.png`.

`?ajax_detections=true&previous_detection_identifier=<id>[&only_name=true]`: "Most Recent Detection" card.
```sql
SELECT Com_Name, Sci_Name, Date, Time, Confidence, File_Name FROM detections ORDER BY Date DESC, Time DESC LIMIT 15
```
Iterates newest first; for each row builds `$filename = "By_Date/<Date>/<comname_safe>/<File_Name>"` and uses the first row whose spectrogram `$home/BirdSongs/Extracted/<filename>.png` exists on disk. If that identifier equals `previous_detection_identifier`, outputs nothing (no change). If `only_name=true`, prints `<comname_safe>,<filename>` and stops. Otherwise resolves the species image (session cache or provider) and renders:

```
<table class="fade-in">   (class omitted when previous id is 'undefined', i.e. first load)
  <h3>Most Recent Detection: <span>Date Time</span></h3>
  <tr><td class="relative">
    <a target=_blank href="index.php?filename=<File_Name>"><img class="copyimage" src="images/copy.png" title="Open in new tab"></a>
    <div class="centered_image_container">
      [<img class="img1" src=image_url onclick=setModalText(...)>]   (only when IMAGE_PROVIDER set and title non-empty)
      <form GET><input hidden name=view value="Species Stats"><button name=species value="<Com_Name>">Com_Name</button></form>
      <i>Sci_Name</i>
      <a href=<info url> target=_blank><img src=images/info.png title=Info></a>
      <a href="https://wikipedia.org/wiki/<Sci_Name with _>" target=_blank><img src=images/wiki.png></a>
      <img src=images/chart.svg title="View species stats" onclick="generateMiniGraph(this,'<Com_Name>')">
      <br>Confidence: NN%
    </div>
    <div class="custom-audio-player" data-audio-src="<filename>" data-image-src="<filename>.png"></div>
  </td></tr>
</table>
```
Confidence display is `round(round(Confidence,2)*100)%`. If no row qualified: if today's count > 0 prints "Your system is currently processing a backlog of audio. This can take several hours before normal functionality of your BirdNET-Pi resumes." else "No Detections For Today."

`?ajax_left_chart=true`: stores `get_summary()` in `$_SESSION['chart_data']` and renders the vertical stats table:
| th | td |
|---|---|
| Total | totalcount |
| Today | button (view=Todays Detections) showing todaycount |
| Last Hour | hourcount |
| Species Detected Today | button (view=Recordings&date=<today>) showing speciestally |
| Total Number of Species | button (view=Species Stats) showing totalspeciestally |

`?ajax_center_chart=true`: horizontal version of the same numbers from session (headers Total, Today, Last Hour, Species Total, Species Today; Today cell has no button, Species Total -> view=Species Stats, Species Today -> view=Recordings&date=today). `.center-column` is shown only at widths <= 1290 px (CSS), `.left-column` otherwise.

### 9.2 Page body (non-AJAX)

Structure: `div.overview` > attribution `<dialog id="attribution-dialog">` (heading, text, Close, and "Blacklist this image" button hidden when IMAGE_PROVIDER is WIKIPEDIA) > `div.overview-stats` > `div.left-column` (filled by ajax_left_chart) + `div.right-column` containing:

1. `div.center-column` (filled by ajax_center_chart).
2. New species / rare species blocks. Query:
```sql
SELECT d_today.Com_Name, d_today.Sci_Name, d_today.Date, d_today.Time, d_today.Confidence, d_today.File_Name,
       MAX(d_today.Confidence) as MaxConfidence,
       (SELECT MAX(Date) FROM detections d_prev WHERE d_prev.Sci_Name = d_today.Sci_Name AND d_prev.Date < DATE('now', 'localtime')) as LastSeenDate,
       (SELECT COUNT(*) FROM detections d_occ WHERE d_occ.Sci_Name = d_today.Sci_Name AND d_occ.Date = DATE('now', 'localtime')) as OccurrenceCount
FROM detections d_today
WHERE d_today.Date = DATE('now', 'localtime')
GROUP BY d_today.Sci_Name
```
(Bare columns come from the max-confidence row of the day, so `Time`/`File_Name` are the best detection today, although the UI labels Time as "First detection".) `LastSeenDate IS NULL` -> new species. Else `days_ago = (now - LastSeenDate).days`; if `days_ago > RARE_SPECIES_THRESHOLD` (default 30) -> rare species with `DaysAgo`.

`display_species($list, $title, $show_last_seen)`: wrapper `div.<title lowercased, spaces->_>` (`new_species`, `rare_species`), heading `<h2>N new species detected today!</h2>` / `N rare species detected today!`. If N > 5: a single button "Open Today's recordings page" (view=Recordings&date=today). Else a table, one row per species:
- td: 50x50 rounded image (if provider) with attribution onclick, title "Image from Flickr".
- td#recent_detection_middle_td: form button (view=Species Stats, species=Com_Name) with class a2, `<i>Sci_Name</i>`, info icon, wikipedia icon, chart icon (rare only, `generateMiniGraph(this,'<Com_Name>',160)`), copy icon to `index.php?filename=`.
- td: `Max confidence: NN%` (`round(Confidence*100)`) + ` (Nx)` when OccurrenceCount > 1, `<br>First detection: HH:MM:SS`, and for rare: `Last seen: Nmo ago` (floor(days/30)) when > 30 days else `Nd ago`.
3. `div.chart`: `<img id="chart" src="Charts/Combo-<today>.png?nocache=<ts>">` only if the file exists.
4. `div#most_recent_detection` (filled by ajax_detections).
5. `<h3>5 Most Recent Detections</h3>` + `div#detections_table` filled from `todays_detections.php?ajax_detections=true&display_limit=undefined&hard_limit=5[&mobile=true when innerWidth<=500]`.
6. `<h3>Currently Analyzing</h3><img id="spectrogramimage" src="spectrogram.png?nocache=<ts>">`.
7. `div#customimage`.

### 9.3 Refresh behavior
- `startAutoRefresh()`: spectrogram image reloaded every `RECORDING_LENGTH` s; `refreshDetection()` every `max(1, RECORDING_LENGTH/4)` s; custom image every 1 s if enabled. All intervals cleared when `document.hidden`, resumed (with an immediate refresh) on visibility.
- `refreshDetection()` skips the check while any custom audio player is actively playing. It passes the first player's `data-audio-src` as the identifier.
- When ajax_detections returns new content (non-empty, not busy, not "No Detections", or first load): replaces `#most_recent_detection`, then reloads left chart (which chains center chart), reloads the 5 most recent, refreshes the chart image via `fetch_chart_string`, and re-runs `initCustomAudioPlayers()`.
- Scroll removes any open mini-graph `.chartdiv`.

---

## 10. Today's Detections (scripts/todays_detections.php) and Kiosk

Public. `view=Todays Detections` or `view=Kiosk` (`$kiosk=true`).

### 10.1 AJAX endpoints

`?comname=<Com_Name>[&days=N]` (mini-graph data, default 30 days):
```sql
SELECT Date, COUNT(*) AS Detections FROM detections WHERE Com_Name = :com_name AND Date BETWEEN DATE("now", "-<days> days") AND DATE("now") GROUP BY Date
```
Then merged with a zero-filled series of the last 31 calendar days (loop `i=0..30`, `date('Y-m-d', strtotime("-$i days"))`), sorted ascending, returned as JSON `[{"date":"YYYY-MM-DD","count":N},...]`. Note: the zero-fill is always 31 days regardless of `days`, so with days=180 the result has 31 zero-filled days plus any additional dated rows from the query, which can break the chronological ordering assumption (ksort on string keys keeps it sorted). Note also `DATE("now")` is UTC here (no 'localtime').

`?today_stats=true`: horizontal stats table (Total, Today, Last Hour, Species Total, Species Today). Today -> Recordings&date=today button; Species Total -> Species Stats button; Species Today -> Recordings&date=today. In kiosk mode the numbers are plain text.

`?ajax_detections=true` with:
- `searchterm=<text>`: if the first word is `not` (case-insensitive), it is stripped and the filter is negated with AND; otherwise OR. Filter fragment:
  `AND (Com_name [NOT] LIKE '%t%' OR|AND Sci_name [NOT] LIKE '%t%' OR|AND Confidence [NOT] LIKE '%t%' OR|AND File_Name [NOT] LIKE '%t%' OR|AND Time [NOT] LIKE '%t%')`
- `display_limit=<N>` (numeric): "Normal view", paged:
  `SELECT Date, Time, Com_Name, Sci_Name, Confidence, File_Name FROM detections WHERE Date == Date('now', 'localtime') <search> ORDER BY Time DESC LIMIT <N-40>,40`
  Page size is fixed at 40; the client starts at `display_limit=40` and increments by 40 via a "Load 40 More..." `button.loadmore` that is appended only when exactly 40 (or more) rows were returned.
- else (legacy / overview usage) with `hard_limit=<N>`: `... ORDER BY Time DESC LIMIT <N>`; without any limit: full day `... ORDER BY Time DESC`.
- `kiosk=true`: time column shows relative time ("just now", "N minutes ago", "1 hour ago", ..., "Yesterday" etc. via `relativeTime()`), hides wiki/chart/copy icons, shows the species image.
- `mobile` (any): legacy row omits the "Confidence:" label and the native `<audio>` column.

Normal-view row markup (per detection):
```
<tr class="relative" id="<n>"><td class="relative">
  <img src="images/delete.svg" class="copyimage" style="right:45px" title="Delete Detection" onclick='deleteDetection("<Date>/<comname_safe>/<File_Name>")'>
  <a target=_blank href="index.php?filename=<File_Name>"><img class="copyimage" src="images/copy.png" title="Open in new tab"></a>
  <div class="centered_image_container">
    [<img class="img1" src=<image_url> onclick=setModalText(...)>]
    <Time><br>
    <b><a class="a2" href="<info url>" target="top">Com_Name</a></b><br>
    <i>Sci_Name</i> <a info.png> <a wiki.png> <img chart.svg onclick=generateMiniGraph(this,'Com_Name')><br>
    <b>Confidence:</b> NN%<br>
  </div><br>
  <div class="custom-audio-player" data-audio-src="/By_Date/<today>/<comname_safe>/<File_Name>" data-image-src="...png"></div>
</td></tr>
```
Note the audio path uses `date('Y-m-d')` (today) rather than the row's Date, which is equivalent for today's detections.

Legacy-view row: `<td>Time (or relative)</td><td#recent_detection_middle_td> [75px image when IMAGE_PROVIDER and (hard_limit or kiosk)] form button (Species Stats) + Sci_Name + info/wiki/chart/copy icons</td><td><b>Confidence:</b> NN%</td><td style="min-width:180px"><audio controls preload="none" src="/By_Date/..."></audio></td>`.

Empty result: `<h3>No Detections For Today.</h3>`.

### 10.2 Page body
- Kiosk: extra header with `images/bnp.png` and SITE_NAME, `<hr>`, nav removed on load (`#myTopnav.remove()`), a fixed "Scroll To Top" button bottom-right (background `#dbffeb`), search box and Legacy toggle hidden, list reloaded once after 60 s (`setTimeout`, not an interval; this is a quirk, it refreshes only once).
- Normal: `<h3>Number of Detections</h3>` + `div#todaystats.overview` (stats table, same as today_stats), `<h3>Today's Detections (em dash in source) <input id="searchterm" placeholder="Search..."></h3>`, `div#detections_table` ("Loading..."), `button.legacyview` "Legacy view" (toggles label to "Normal view"; legacy loads with `display_limit=undefined`, i.e. the full day in legacy markup; the heading shows "Loading <todaycount> detections..."). Search submits on Enter only.
- `deleteDetection(filename, copylink)`: confirm, GET `play.php?deletefile=<Date>/<comname_safe>/<File_Name>`; on "OK" reloads (or `window.top.close()` when opened from a deep link); otherwise alerts "Database busy.".
- Attribution dialog and blacklist logic identical to overview.

---

## 11. Spectrogram (scripts/spectrogram.php)

Public page; `legacy=true` forces image mode. iPhone user agents are forced to legacy mode.

### 11.1 AJAX `?ajax_csv=true&newest_file=<name>`
Reads the newest `RECS_DIR/StreamData/*.wav.json`:
- No RTSP: `glob("*.wav.json")[0]`.
- RTSP: scans the directory ascending and takes the last file containing `RTSP_<RTSP_STREAM_TO_LIVESTREAM + 1>` and `.wav.json`.
If the name equals `newest_file` it returns nothing. Otherwise returns the JSON with an added `delay` = whole seconds between the file's `timestamp` and now. The JS overlays `common_name` text on the canvas at x = `canvasWidth - (delay - start) * avgfps` px (so the label lands where that audio second scrolled to), y staggered by 15 px steps up to 60, alpha = confidence (min 0.2), font `15px Roboto Flex`. Polled every 1 s.

### 11.2 Live mode UI
- Controls (`div.centered`): optional `RTSP Stream:` `<select id="rtsp_stream_select">` listing hostnames parsed from `RTSP_STREAM` (option value = 0-based index, preselected from `RTSP_STREAM_TO_LIVESTREAM`; if the saved index is out of range the PHP rewrites the config to `"0"` and restarts livestream.service). On change: GET `views.php?rtsp_stream_to_livestream=<i>&view=Advanced&submit=advanced`, then after 10 s reloads the `<audio>` src `stream`.
- `Gain:` range 0..250 (default 100) -> `gainNode.gain = value/50`.
- `Compression:` checkbox -> inserts a DynamicsCompressor (threshold -50, knee 40, ratio 12, attack 0, release 0.25).
- `Freq shift:` checkbox (checked when `ACTIVATE_FREQSHIFT_IN_LIVESTREAM == "true"`) -> GET `views.php?activate_freqshift_in_livestream=<bool>&view=Advanced&submit=advanced` (requires auth; restarts livestream), then reconnects the player after `FREQSHIFT_RECONNECT_DELAY` ms with a spinner.
- Hidden `<audio id="player" crossorigin="anonymous" preload="none"><source id="playersrc" src="stream">`; if the parent document (index.php with `?stream`) already has an audio element, that one is used as the source instead.
- Full-width `<canvas>` (height 85%): Web Audio AnalyserNode fftSize 2048; each frame shifts the canvas left 1 px and draws a vertical line of `frequencyBinCount` bins, color `hsl((rat*120)+280 % 360 ..., 100%, 10+70*rat %)` on a `hsl(280,100%,10%)` background. Player source error redirects to `views.php?view=Spectrogram&legacy=true`.

### 11.3 Legacy mode
Shows `<img id="spectrogramimage" src="spectrogram.png?nocache=...">` at 100% and reloads it every `RECORDING_LENGTH` s. Canvas, player, controls removed.

---

## 12. Best Recordings (scripts/stats.php, nav label "Best Recordings", view=Species Stats)

Public.

### 12.1 Parameters
- `sort` = `alphabetical` (default) | `occurrences` | `confidence` | `date` (via `fetch_species_array`).
- `species=<Com_Name>`: shows the detail panel for that species.

### 12.2 Layout: `div.stats` with two `div.column`s
Left column: sort button row (`.sortbutton`, images sort_abc/sort_occ/sort_conf/sort_date, `.active` on current) then a table of species buttons `name=species value=<Com_Name>` labelled by `get_label()`; 3 columns when more than 45 species, else 1, filled column-major (`index = row + col*num_rows`).

Center column (`div.column.center`):
- No species: `<p class="centered">Choose a species to load images from Flickr.</p>`.
- With species: `fetch_best_detection(Com_Name)` and renders `<h3>Com_Name</h3>` and a table cell with: copy icon (`index.php?filename=`), `<i>Sci_Name</i>`, info and wikipedia icons, `Occurrences: N`, `Max Confidence: NN%`, `Best Recording: Date Time`, and `<video controls poster="/By_Date/<Date>/<comname_safe>/<File_Name>.png" title=...><source src="/By_Date/.../<File_Name>"></video>` (a `<video>` element with the spectrogram as poster; onplay ducks live audio). Then `<p>Loading Images from Flickr</p>`, output padded to 6096 bytes and flushed so the browser renders before the Flickr call. Page scrolls to the first h3.
- If `FLICKR_API_KEY` set (regardless of IMAGE_PROVIDER): `flickr.photos.search&text="<English name>"&license=2,3,4,5,6,9&sort=relevance&per_page=15` and renders up to 15 `<img>` thumbnails (`https://farm<farm>.static.flickr.com/<server>/<id>_<secret>.jpg`), each clickable to open the attribution dialog with "Photo N: "<title>" Attribution", image link `https://flickr.com/photos/<owner>/<id>` and author link `https://flickr.com/people/<owner>`.
- Below: `div.brbanner` "Best Recordings for Other Species:" (or `<hr>` when no species), then a table listing every species (same sort) as rows: copy icon, button (species=Com_Name), `Occurrences: Count`, `Max Confidence: NN%`, `Best Recording: Date Time`, `<video controls preload="none" poster="<png>"><source src="<audio>" type="audio/mp3"></video>`.

### 12.3 Side effect: purge protection list
Each render rewrites `$home/BirdNET-Pi/scripts/disk_check_exclude.txt`: the section between `##start` and `##end` is replaced with every species' best-recording path and its png (`<Date>/<comname_safe>/<File_Name>` and `...png`), preserving everything from `##end` onward (the manually locked files). If the file is missing or lacks `##start`, it is reset to `##start\n##end\n`. disk_check.sh curls `views.php?view=Species%20Stats` before purging to refresh this list.

---

## 13. Species Stats (Streamlit, scripts/plotly_streamlit.py, nav label "Species Stats", view=Streamlit)

Served at `/stats` (port 8501), embedded in an iframe. Public.

### 13.1 Data
```sql
SELECT COUNT(*) FROM detections WHERE Date = DATE('<today>')     -- cache key only
SELECT Date, Time, Sci_Name, Com_Name, Confidence, File_Name FROM detections   -- full table, cached 5 min
```
`normalise_com_name`: keeps the original Com_Name as `Directory` (used for file paths) and replaces `Com_Name` with the latest Com_Name seen for each Sci_Name (handles language changes). Index = `DateTime = Date + " " + Time`.

### 13.2 Sidebar controls
- `Single Day View` checkbox. If checked: `Date to View` date input (min/max = data range, default max). Else: `Date Range` slider (min = first date - 1 day, max = last date, default full range).
- Date filter: `index >= start_date AND index <= end_date + 1 day`.
- `Resample Resolution` radio: single day -> `Raw`, `15 minutes`, `Hourly` (default 15 minutes); multi-day -> adds `DAILY`. Resampling: for non-Raw, `df.resample(rule)['Com_Name'].aggregate('unique').explode()` (so a species counts at most once per bin).
- `Select Number of Birds to Show` slider 1..N species, default min(10, N).
- In the DAILY multi-day species view: `Select Color Pallet for Daily Detections` selectbox over all plotly named colorscales.

### 13.3 Views
Species list for the selectbox: `hourly = pd.crosstab(df5, df5.index.hour, margins=True)`, sorted by the `All` column descending; `species` includes `'All'` as the first entry.

(a) Multi-day, resample != DAILY, species == 'All' (`Which bird would you like to explore for the dates X to Y?`):
- 3x2 subplot grid. Row1-3 col1: horizontal bar (`go.Bar orientation='h'`, color `seagreen`) of top_N species counts, `yaxis categoryorder total ascending`; title `Top N Species in Date Range X to Y for <resample> sampling interval.`
- Rows 1-2 col2: `go.Barpolar` of 'All' counts per hour (24 bins, theta 0..345 step 15, clockwise, rotation -90, labels 12am..11pm), seagreen; annotation `Total Detect:<n>`.
- Row3 col2: daily bar of counts per date (`pd.crosstab(df5, df5.index.date)` row 'All'), seagreen.
- Layout width 1000 height 500, no legend.

(b) Multi-day, resample != DAILY, specific species: two columns. Col1: polar hour plot + daily bar for that species, then subheader `Total Detect:N   Confidence Max:NN.NN%   Median:NN.NN%` (from raw df2 for that Com_Name). Col2: `Recordings` selectbox listing that species' `File_Name`s newest first; shows `st.image(~/BirdSongs/Extracted/By_Date/<Date>/<Directory sanitized>/<File_Name>.png)` and `st.audio(... <File_Name>)`; "Recording not available" on error.

(c) Multi-day, resample == DAILY: species selectbox (without 'All'). Builds a 15-minute x date matrix: `df2['Com_Name'][== specie].resample('15min').count()`, unstacked to date (x) by time-of-day (y). `go.Heatmap(x=dates 'DD-MM-YYYY', y=decimal hours, z=counts, colorscale=<selected>, showscale False)` plus an orange `go.Scatter` line of sunrise and sunset times per date (computed with `suntime.Sun(LATITUDE, LONGITUDE)` in local tz; the two series are joined with a `None` gap), hover text `HH:MM Sunrise`/`HH:MM Sunset`. Y ticks: every `len(labels)/12`-th 15-min label.

(d) Single day: 1x2 subplot sharing y. Col1: horizontal bar of top_N species counts (seagreen), title `Top N Species For <date>`. Col2: heatmap species x hour (0..23), z = row-normalized (L1) counts, cell text = raw counts (blank for 0), colorscale `Blugrn`, no colorbar, y reversed, ticks on boundaries; title `Daily <date> Detections on <resample> interval`.

"No data yet. Please come back later." when the table is empty.

---

## 14. Daily Charts (scripts/history.php + scripts/daily_plot.py)

Public.

### 14.1 history.php parameters
- `date=YYYY-MM-DD` (default today). `$chart = "Combo-$date.png"`, `$chart2 = "Combo2-$date.png"`.
- `blocation=...&state=&country=&protocol=&num_observers=&dist_traveled=&notes=&date=`: eBird CSV export (see 14.3).

### 14.2 Page
```sql
SELECT COUNT(*) FROM detections WHERE Date == "<date>"
```
Markup: `div.history.centered` > hidden eBird dialog > `<form GET views.php><input type="date" name="date" value=<date>><button name=view value="Daily Charts">Submit Date</button></form>` > `<table class="overview"><tr><th>Total Detections For The Day</th><td>N</td><td><img id="SwipeSpinner" src="images/spinner.gif" hidden></td></tr></table>` > `<img src="/Charts/Combo-<date>.png?nocache=...">` or `<p>No Charts for <date></p>` > `<hr>` > `<img src="/Charts/Combo2-<date>.png">` or `<p>No Charts For <date></p>`. The "Export as CSV for eBird" button is commented out in the staged source, so the dialog is unreachable from the UI, but the endpoint still works. Left/Right keys and swipes change the date (see 8.6).

This fork's daily_plot.py never writes `Combo2-*.png`, so the second slot always reads "No Charts For <date>" on a fresh install.

### 14.3 eBird CSV export (`?blocation=...`)
Headers: `Content-type: text/csv`, `Content-Disposition: attachment; filename=result_file.csv`. For each hour 0..23:
```sql
SELECT DISTINCT(Com_Name), COUNT(*) FROM detections WHERE Date == "<date>" AND Time > '<HH:00>' AND Time < '<HH+1:00>' AND Confidence > 0.75 GROUP By Com_Name ORDER BY COUNT(*) DESC
```
One CSV row per species per hour: `[Com_Name, '', '', '1', '', blocation, LATITUDE, LONGITUDE, m/d/Y, HH:MM, state, country, protocol, num_observers, '60', 'Y', dist_traveled, '', notes]` (eBird Record Format Extended: species, genus, species blank, count 1, comments blank, location, lat, lon, date, start time, state, country, protocol, observers, duration 60 min, all obs reported Y, distance, area blank, notes). The dialog's success text links to `https://ebird.org/content/eBirdCommon/docs/ebird_import_data_process.pdf`.

### 14.4 daily_plot.py (chart_viewer.service)
Runs as a daemon, sleeping 2 minutes between runs; when the day rolls over it regenerates yesterday's chart one last time with `now = yesterday 23:59`.
```sql
SELECT * from detections WHERE Date = DATE('<YYYY-MM-DD>')
```
Adds `Hour of Day = Time.hour`. `create_plot(df, now)` with `is_top=None` (all species):
- Figure: `plt.subplots(1, 2, figsize=(10, height), gridspec_kw=width_ratios [3, 6], facecolor)` where `height = readings/3 + 1.06` (readings = number of species), facecolor `#77C487` (light) or `darkgrey` (dark).
- Species order (`freq_order`): by count descending.
- Bar colors: per-species max confidence normalized between min and max confmax, mapped through `Greens` (light) or `Greys` (dark) colormap; edgecolor lightgrey.
- Left: `sns.countplot(y='Sci_Name', order=freq_order)`; count value drawn at 90% of bar width in a lightgrey box (text darkgreen or black in dark mode, size 9); y tick labels are common names (latest Com_Name per Sci_Name, wrapped at ~16 chars adjusted for glyph widths), fontsize 10; xlabel "Detections", no ylabel.
- Right: `sns.heatmap` of `pd.crosstab(Sci_Name, Hour of Day)` reindexed to all 24 hours, zeros masked to NaN, `norm=LogNorm()`, `annot=True` (fontsize 7, fmt g), same cmap, no colorbar, linewidths 0.5 grey, no y labels, xlabel "Hour of Day", x ticks 0..23 size 8 with the current hour colored yellow (light) or white (dark), visible border.
- Title: `All <readings> Last Updated: YYYY-MM-DD HH:MM`, tight_layout, wspace 0.
- Saved to `~/BirdSongs/Extracted/Charts/Combo-<YYYY-MM-DD>.png`. Font from `get_font()` (Roboto Flex, or Noto variants for ar/ja/zh/ko/th).

---

## 15. Weekly Report (scripts/weekly_report.php, scripts/weekly_report.sh)

Public. `?ascii=true` returns the notification variant.

Week window: `startdate = last sunday - 7 days`, `enddate = last sunday - 1 day` (PHP `strtotime('last sunday')`), i.e. the most recently completed Monday..Sunday week. Prior week = both shifted by 7 days.

Queries:
```sql
SELECT Sci_Name, Com_Name, COUNT(*) FROM detections WHERE Date BETWEEN "<start>" AND "<end>" GROUP By Sci_Name ORDER BY COUNT(*) DESC
-- per species:
SELECT COUNT(*) FROM detections WHERE Sci_Name == "<sci>" AND Date BETWEEN "<start-7>" AND "<end-7>"
SELECT COUNT(*) FROM detections WHERE Sci_Name == "<sci>" AND Date NOT BETWEEN "<start>" AND "<end>"      -- is_first_seen when 0
-- totals:
SELECT COUNT(*) FROM detections WHERE Date BETWEEN "<start>" AND "<end>"
SELECT COUNT(*) FROM detections WHERE Date BETWEEN "<start-7>" AND "<end-7>"
SELECT COUNT(DISTINCT(Sci_Name)) FROM detections WHERE Date BETWEEN "<start>" AND "<end>"
SELECT COUNT(DISTINCT(Sci_Name)) FROM detections WHERE Date BETWEEN "<start-7>" AND "<end-7>"
```
`safe_percentage(count, prior)` = `round((count-prior)/prior*100)`; `INF` when prior is 0 and count > 0; 0 when both 0. Positive renders green `+N%`, otherwise red `-N%` (zero renders as red `-0%`).

HTML view: `div.brbanner` with `<h1>Week <ISO week of enddate> Report</h1>` and `<Month jS, Y> (em dash) <Month jS, Y>`; then a borderless outer table with two inner tables: "Top 10 Species:" (rows `Com_Name<br><small>count (pct)</small>`) and "Species Detected for the First Time:" (rows `Com_Name<br><small><scount></small>`; note `$scount` is a leftover loop variable so it shows the last species' count, a bug; "No new species were seen this week." when none). Footer: `* percentages are calculated relative to week <W-1>`.

ASCII/notification view (`ascii=true`): 
```
# BirdNET-Pi: Week W Report
Total Detections: <b>N</b> (<pct>)<br>
Unique Species Detected: <b>N</b> (<pct>)<br><br>
= <b>Top 10 Species</b> =<br>
<Com_Name> - <count> (<pct>)<br> ... (10 rows)
<br>= <b>Species Detected for the First Time</b> =<br>
<Com_Name> - <count><br> ... or "No new species were seen this week."
<hr><span>* data from <start> (em dash) <end>.</span><br><span>* percentages are calculated relative to week <W-1>.</span>
```
weekly_report.sh (cron): if `APPRISE_WEEKLY_REPORT == 1`, curls `localhost/views.php?view=Weekly%20Report&ascii=true`, strips everything up to the first `#`, uses the first line as the title and the rest as HTML body: `apprise -vv -t "<title>" -b "<body>" --input-format=html --config=$HOME/BirdNET-Pi/apprise.txt`.

---

## 16. Recordings (scripts/play.php)

Public browsing; mutations need auth.

### 16.1 Navigation parameters (all under `view=Recordings`)
- none: "choose" view: two buttons `By Species` (`byspecies=byspecies`) and `By Date` (`bydate=bydate`). Clears `$_SESSION['species']` and `$_SESSION['date']`.
- `bydate`: 
  ```sql
  SELECT DISTINCT(Date) FROM detections GROUP BY Date ORDER BY Date DESC
  ```
  One button per date (`name=date value=<date>`, label "Today" for today) but only when the directory `$home/BirdSongs/Extracted/By_Date/<date>` exists.
- `date=<YYYY-MM-DD>[&sort=]`: stores `$_SESSION['date']`; `fetch_species_array(sort, date)`; lists species buttons (`name=species value=<Sci_Name>`, label via `get_label(..., date)`) only for species whose directory `By_Date/<date>/<comname_safe>` exists. Sort bar (alphabetical, occurrences, confidence, date) with hidden `date` carried along. 3 columns when > 45 species.
- `byspecies[&sort=]`: `fetch_species_array(sort)` over all dates; same button grid (no directory check). Sort bar carries `byspecies`.
- `species=<Sci_Name>[&sort=date|confidence][&only_excluded=on][&limit=N]`: detail list, filtered by `$_SESSION['date']` if one was set earlier in the session (sticky; it persists until the user returns to the "choose" view). Sort bar: `date` (default, sort_date.svg) and `confidence` (sort_occ.svg image, title "Sort by confidence"). A toggle switch "Only Show Purge Excluded" submits on change.
- `filename=<File_Name>`: single-recording view (used by `index.php?filename=`):
  ```sql
  SELECT * FROM detections where File_name == "<File_Name>" ORDER BY Date DESC, Time DESC
  ```

### 16.2 Species detail rendering
Header cell: `Com_Name` (from first row), `<i>Sci_Name</i>`, info and wikipedia icons. `$limit` default 40. For each detection (`fetch_all_detections(sci, sort, session date)`):
- `$filename = /By_Date/<Date>/<comname_safe>/<File_Name>`, `$filename_shifted = /By_Date/shifted/<Date>/<comname_safe>/<File_Name>`, `$filename_formatted = <Date>/<comname_safe>/<File_Name>`.
- Skip if `$home/BirdSongs/Extracted<$filename>` does not exist (purged).
- If `only_excluded` set, skip unless `$filename_formatted` is a line in `disk_check_exclude.txt`.
- Stop after `$limit` rows and show a "Load 40 more..." form (`limit = limit+40`, carrying species, sort, only_excluded, session date).
- First 99 rows use the custom audio player (`div.custom-audio-player data-audio-src data-image-src`); from row 100 on, a plain `<a href=audio><img src=png></a>`.
- If a shifted copy exists on disk, the audio src points at the shifted path.
- Row cell `td.relative` contains four absolute-positioned 25 px icons (class `copyimage`): delete.svg (right:120px, `deleteDetection(filename_formatted)`), bird.svg (right:85px, `changeDetection(filename_formatted)`, "Change Detection"), lock/unlock.svg (right:45px, `toggleLock(filename_formatted, 'add'|'del', this)`, unlock title "This file will be deleted when disk space needs to be freed (>95% usage)." / lock title "This file is excluded from being purged."), shift/unshift.svg (right:7px default, `toggleShiftFreq(filename_formatted, 'shift'|'unshift', this)`, titles "This file is not shifted in frequency." / "This file has been shifted down in frequency."); then `Date Time<br>NN%<br>` and the player.
- Zero rows: "No recordings were found." plus the explanation about purging and a link to `views.php?view=Advanced`.

The `filename=` view renders the same cell (delete passes `copylink=true` so success closes the tab) without pagination or the sort bar. (`$url_title` is never defined in play.php, so the info icon's title attribute is empty.)

### 16.3 Mutation endpoints (GET, all `die()` with a plain-text result)
- `?deletefile=<Date>/<comname_safe>/<File_Name>`: auth. Rejects paths containing `../`. Opens the DB read-write and runs
  ```sql
  DELETE FROM detections WHERE File_Name = :file_name LIMIT 1
  ```
  (bound to the third path segment), then `sudo rm <EXTRACTED>/By_Date/<path> && sudo rm <path>.png`. Prints `OK` on rm success, else `Error - file deletion failed : ...`; appends `Error - database line deletion failed : ...` if 0 rows changed. (The `LIMIT 1` on DELETE requires SQLite built with SQLITE_ENABLE_UPDATE_DELETE_LIMIT; it works on Debian builds.)
- `?excludefile=<path>&exclude_add=true`: auth. Creates `disk_check_exclude.txt` with `##start\n##end\n` if missing, appends `<path>` and `<path>.png`. Prints `OK`.
- `?excludefile=<path>&exclude_del=true` (any value other than exclude_add): removes every line containing `<path>` or `<path>.png` (case-insensitive substring). Prints `OK`.
- `?getlabels=true`: no auth. Returns JSON array of `scripts/labels.txt` lines (`Sci_Common` strings).
- `?changefile=<path>&newname=<Sci name_Common name>`: auth. Runs `birdnet_changeidentification.sh "<basename>" "<newname>" log_errors`. That script (upstream main): validates newname exists in `model/labels.txt` and differs in common name; looks up `SELECT Sci_Name, Com_Name, Date FROM detections WHERE File_Name = '<old>' LIMIT 1`; computes the new file name by replacing the old comname_safe with the new one inside the old File_Name (the embedded confidence stays); moves the audio and png to `By_Date/<Date>/<new comname_safe>/<new name>`; then `UPDATE detections SET Sci_Name = '<new sci>', Com_Name = '<new com>', Confidence = '0', File_Name = '<new name>' WHERE File_Name = '<old>'`. The UI reloads (or closes the tab) on `OK` after alerting "Successfully converted".
- `?shiftfile=<path>&doshift=true`: auth. Creates `EXTRACTED/By_Date/shifted/<Date>/<comname_safe>/` and writes a pitch-shifted copy: ffmpeg `-af rubberband=pitch=<FREQSHIFT_LO>/<FREQSHIFT_HI>` or sox `pitch -q <FREQSHIFT_PITCH>` depending on `FREQSHIFT_TOOL`. Prints `OK` immediately (the conversion runs under nohup). The JS swaps the player's `data-audio-src` between `/By_Date/` and `/By_Date/shifted/`.
- `?shiftfile=<path>` (no doshift): deletes the shifted copy. Prints `OK`.

### 16.4 Change-detection modal (JS `changeDetection`)
Builds `div#myModal.modal` > `.modal-content` with `<h2>Please select the correct species here:</h2>`, a filter `<input id="filterInput" placeholder="Type to filter...">`, a Cancel button, and a `<select id="labelDropdown" size=5>` filled from `getlabels`; filtering is case-insensitive substring; selecting an option prompts "Are you sure you want to change the specie identified in this detection to <name>?" then calls `changefile`.

---

## 17. View Log

`view=View Log` renders an iframe of `/log` (gotty on :8080 showing the journal of the core services, via birdnet_log.service). No parameters. Public at the PHP level.

---

## 18. Tools hub and sub-pages

`view=Tools` (auth): `div.centered` with a second `form#views` containing buttons: Settings, System Info, System Controls (with update badge), Services, File Manager (`view=File`), Database Maintenance (`view=Adminer`), Web Terminal (`view=Webterm`), Custom Species List (`view=Included`), Excluded Species List (`view=Excluded`), Whitelist Species List (`view=Whitelisted`), Species Management.

### 18.1 Settings (scripts/config.php, view=Settings)

Auth required. GET form `#basicform` (action "", so it posts back to views.php with `view=Settings`, `submit=settings`, `status=success`).

Endpoints when called directly as `scripts/config.php`:
- `?threshold=<0..1>`: runs `species.py --threshold <t>` and prints its stdout: a header line `Getting species list for <lat>/<lon>, Week <w>...`, then one line per species in the location model's list, `<Sci_Common> - <frequency 4dp>`, sorted by frequency descending, followed by an explanatory paragraph. Used by the "Species List Tester" modal and by Species Management (threshold=0 to get all probabilities).
- `?restart_php=true`: `sudo service php*-fpm restart`.
- `?sendtest=true&apprise_config=&apprise_notification_title=&apprise_notification_body=`: writes temp files and runs `send_test_notification.py --body <tmp> --config <tmp> --title '<title>'`, prints output in `<pre class="bash">`.

Save handler (triggered when `latitude` is present in GET): reads all fields, rewrites the keys listed below in birdnet.conf, writes `apprise.txt` and `body.txt`, sets timezone via `timedatectl set-timezone` (+ `/etc/timezone`), optionally sets the system clock (`timedatectl set-ntp false` + `date -s`) when `date` and `time` are submitted, else ensures NTP is on, restarts chart_viewer and reloads the parent window if SITE_NAME or COLOR_SCHEME changed, runs `install_language_label.sh` if MODEL or DATABASE_LANG changed (2-letter languages only), then `sudo restart_services.sh`. Shows `alert("Settings successfully updated")` when `status` is present.

Form sections (`table.settingstable` blocks under `div.settings`, header `div.brbanner > h1 "Basic Settings"`):
1. Model: `<select name="model">` options `BirdNET_GLOBAL_6K_V2.4_Model_FP16`, `BirdNET_6K_GLOBAL_MODEL`; `<span id="soft">` (hidden for the legacy model) with checkbox `data_model_version` "Species range model V2.4 - V2" (link to kahst/BirdNET-Analyzer discussion 234), number `sf_thresh` [0.0005, 0.99] "Species Occurrence Frequency Threshold", a "[more info]" expander with the flowchart image and a "Species List Tester" button that opens `<dialog id="modal">` (threshold input, "Preview Species List", `<pre id="output">`, Close). Descriptions of both models and a wiki link.
2. Location: `site_name` text (Optional), `latitude` number [-90,90] step 0.0001 required, `longitude` [-180,180] required, link to latlong.net.
3. BirdWeather: `birdweather_id` text, descriptive text with links to app.birdweather.com, login, and account/stations.
4. Notifications: `textarea name="apprise_input"` (Apprise URLs, one per line, placeholder examples), a `<dl>` documenting template variables (`$sciname`, `$comname`, `$confidence`, `$confidencepct`, `$listenurl`, `$friendlyurl`, `$date`, `$time`, `$week`, `$latitude`, `$longitude`, `$cutoff`, `$sens`, `$overlap`, `$image`, `$reason`), `apprise_notification_title` text, `apprise_notification_body` textarea, checkboxes `apprise_notify_new_species` ("Notify each new infrequent species detection (<5 visits per week)"), `apprise_notify_new_species_each_day` ("Notify each species first detection of the day"), `apprise_notify_each_detection` ("Notify each new detection"), `apprise_weekly_report` ("Send weekly report", link to the report); checkboxes only render checked when the flag is 1 AND apprise.txt is non-empty. Then `minimum_time_limit` number (seconds), `only_notify_species_names` ("Exclude these species (comma separated common names)"), `only_notify_species_names_2` ("ONLY notify for these species"), and a "Send Test Notification" button (`#testsuccessmsg` shows output + "Test sent! Make sure to Update Settings below.").
5. Bird Photo Source: `<select name="image_provider">` None (`""`), Wikipedia, Flickr (disabled unless FLICKR_API_KEY set); `flickr_api_key` text (link to Flickr API keys page); `flickr_filter_email` email.
6. Localization: `<select name="language">` with `not-selected` plus 36 language codes (af, ar, ca, cs, zh_CN, zh_TW, hr, da, nl, en, et, fi, fr, de, hu, is, id, it, ja, ko, lv, lt, no, pl, pt, ro, ru, sr, sk, sl, es, sv, th, tr, uk, vi). "! Only modify this at initial setup !".
7. Additional Info: `<select name="info_site">` ALLABOUTBIRDS (allaboutbirds.org), EBIRD (ebird.org).
8. Color scheme: `<select name="color_scheme">` light, dark.
9. Time and Date: checkbox "If connected to the internet, retrieve time automatically?" (checked and inputs disabled when `timedatectl` reports NTP active), `<input type="date" id="date">`, `<input type="time" id="time">`, `<select name="timezone">` listing the first 425 of `DateTimeZone::listIdentifiers()` with the current one selected.
10. Hidden `status=success`, `submit=settings`; submit button "Update Settings" (`name=view value=Settings`), and a separate form button "Advanced Settings" (`view=Advanced`).

### 18.2 Advanced Settings (scripts/advanced.php, view=Advanced)

Auth required. GET form `#advancedform` with hidden `view=Advanced`; submit button `name=submit value=advanced`. Save handler runs when `submit` is present: for each field, rewrite the key only if changed; then write the file, reload config, run `update_caddyfile.sh` (background) if CADDY_PWD or BIRDNETPI_URL changed, `sudo restart_services.sh`, and `systemctl restart livestream.service` if ICE_PWD, RTSP_STREAM, RTSP_STREAM_TO_LIVESTREAM, ACTIVATE_FREQSHIFT_IN_LIVESTREAM, or the livestream log level changed. The Spectrogram page calls this handler via XHR with only `rtsp_stream_to_livestream` or `activate_freqshift_in_livestream` (checkbox-style keys SILENCE_UPDATE_INDICATOR, AUTOMATIC_UPDATE, RAW_SPECTROGRAM are forced to 0 and RARE_SPECIES_THRESHOLD to 30 whenever absent from the request, so those XHR calls reset them; this is an upstream quirk).

`?run_species_count=1`: runs `disk_species_count.sh` and shows the output in a JS `alert()`.

Sections (header `div.brbanner > h1 "Advanced Settings"`):
1. Privacy Threshold: range `privacy_threshold` 0..3, "Value: N%", text "If a Human is predicted anywhere among the top <max(10, value*6000/100)> predictions, the sample will be considered of human origin and no data will be collected. Start with 1% and move up as needed."
2. Disk Management: radio `full_disk` purge|keep; number `purge_threshold` 20..99; number `max_files_species` >= 0 with explanation (files newer than 7 days and locked files exempt; only audio/png deleted, DB rows kept); button "[Click here for disk usage summary]" (`run_species_count`).
3. Audio Settings: `rec_card` text required (default/dsnoop guidance), `channels` 1..32, `recording_length` 3..60 (UI text says 6..60, multiples of 3 recommended), `extraction_length` min 3 max = recording length (JS-linked), `<select name="audiofmt">` with the current value first then the full sox format list (8svx ... xi), RTSP streams: hidden `rtsp_stream` collector plus one `<input type=url name="rtsp_stream_<i>">` per existing stream and an "Add" span that clones a placeholder input; on submit JS joins all non-empty `rtsp_stream_*` values with commas into `rtsp_stream`.
4. BirdNET-Pi Password: `caddy_pwd` password field, pattern `[A-Za-z0-9]+`, "show" on hover.
5. Custom URL: `birdnetpi_url` url (trailing slash stripped).
6. Options: checkboxes `silence_update_indicator`, `automatic_update` ("each Sunday at 3:00 AM"), `raw_spectrogram` ("Minimalist Spectrograms"); number `rare_species_threshold` min 1 (default 30).
7. Custom Image: `custom_image` (absolute path), `custom_image_label`.
8. BirdNET-Lite Settings: `overlap` 0.0..2.9 step 0.1, `confidence` 0.01..0.99 step 0.01, `sensitivity` 0.5..1.5 step 0.01, all required.
9. Accessibility Settings: `<select name="freqshift_tool">` (current first, then sox/ffmpeg), `freqshift_hi` 0..20000 ("Origin [Hz]"), `freqshift_lo` ("Target [Hz]"), `freqshift_reconnect_delay` 1000..10000 step 100 ms, `freqshift_pitch` -4000..4000 (cents).
10. Logging: three selects `LogLevel_BirdnetRecordingService`, `LogLevel_LiveAudioStreamService`, `LogLevel_SpectrogramViewerService` with values error (default), warning, info, debug, plus a warning callout and explanations.
Footer: "Update Settings" button and a "Basic Settings" button (`view=Settings`).

### 18.3 System Info (phpSysInfo)
`view=System Info` iframes `phpsysinfo/index.php`. `templates/index_bootstrap.html` is the stock phpSysInfo bootstrap template with one BirdNET-specific change: the template selector reads `COLOR_SCHEME` via `common.php` and selects `dark` or `green` (templates/green_bootstrap.css). Blocks: System vitals (Hostname, Listening IP, Kernel, Distro, OS Type, Uptime, Last boot, Current Users, Load Averages, System Language, Code Page, Processes), Hardware, Memory Usage, Mounted Filesystems, Network Interface, Voltage, Current, Temperatures, Fans, Power, Other, UPS, plugins. All data comes from phpSysInfo's own XML/JSON backend, not from BirdNET.

### 18.4 System Controls (scripts/system_controls.php, view=System Controls)
Auth. On render re-runs `git fetch`/`git status` to refresh `$_SESSION['behind']`. Form GET views.php with `submit` buttons: Reboot (`sudo reboot`, confirm), Update (`update_birdnet.sh`, confirm, shows an elapsed timer, red badge with the behind count), Shutdown (`sudo shutdown now`, confirm), Clear ALL data (`sudo clear_all_data.sh`, confirm "Clear ALL Data? Note that this cannot be undone and will take up to 90 seconds."). Then "Restore data" (plupload html5 uploader, chunk 2 MB, single `.tar`, max size = free disk space / 1.001, posts chunks to `scripts/restore.php`; on completion fetches `views.php?submit=cat $home/BirdSongs/restore.log` and replaces the body with the output) and "Backup data" (`<a href="scripts/backup.php" download>`, confirm; backup.php streams `backup_data.sh -a backup -f -` as `backup-<Ymd\THis>.tar`). Footer: "Running version:" and the current commit hash linked to `https://github.com/Nachtzuster/BirdNET-Pi/commit/<hash>`. `<pre id="console">` for upload errors.

### 18.5 Services (scripts/service_controls.php, view=Services)
Auth. For each service an `<h3>` with a status span: green `(active)` when `systemctl status` shows `active (running)` or `active (mounted)`, orange `(inactive)`, else red `(<state> [<substate>])`; for birdnet_analysis.service, if `ls ~/BirdSongs/StreamData | wc -l` > 200, orange `(stalled - backlog of N files in ~/BirdSongs/StreamData/)`. Button groups (`div.btn-group-center`, `submit` values are the exact allowed commands): Live Audio Stream (Stop/Restart/Disable/Enable, each also controlling icecast2), Web Terminal, BirdNET Log, BirdNET Analysis, Streamlit Statistics (birdnet_stats), Recording Service, Chart Viewer, Spectrogram Viewer (each Stop/Restart/Disable --now/Enable --now), Ram drive (!experimental!) Disable/Enable (`systemctl disable|enable <mount unit> && sudo reboot`, confirm), Stop Core Services (`stop_core_services.sh`), Restart Core Services (`restart_services.sh`).

### 18.6 File Manager, Database Maintenance, Web Terminal
- `view=File`: iframe `scripts/filemanager/filemanager.php` (Tiny File Manager, third-party).
- `view=Adminer`: iframe `scripts/adminer.php` (Adminer against birds.db, third-party).
- `view=Webterm`: auth; iframe `terminal` (gotty).

### 18.7 Custom / Excluded / Whitelist species lists (scripts/species_list.php)
`view=Included` (title "Included", file include_species_list.txt, message "Warning! If this list contains ANY species, the system will ONLY recognize those species. Keep this list EMPTY unless you are ONLY interested in detecting specific species."), `view=Excluded` ("Once the desired species has been highlighted, click it and then click ADD to have it excluded."), `view=Whitelisted` (message about detecting even below the occurrence threshold; "not a recommended way of working").

Layout: `div.left-column` with the message; `div.customlabels.column1` form `#add`: `<h3>All Species Labels</h3>`, search `#species_searchterm` (client-side filter of options, case-insensitive substring), `<select name="species[]" id="species" multiple size=25>` of every line of `scripts/labels.txt`, hidden `add=add`; `div.customlabels.column2` with buttons `>>ADD>>` (form add) and `REMOVE` (form del); `div.customlabels.column3` form `#del`: `<h3><Title> Species List</h3>`, `<select name="species[]" id="value2" multiple size=25>` of the current file's lines ("Please Select" disabled option when empty), hidden `del=del`. Submitting with nothing selected alerts "Please click the species you want to add.". Buttons submit with `view=<Title>`, which views.php maps back to the mutation (see 8.4).

### 18.8 Species Management (scripts/species_tools.php, view=Species Management)
Auth on every entry. Sanitizes input with `FILTER_SANITIZE_FULL_SPECIAL_CHARS`.

Main query:
```sql
SELECT Com_Name, Sci_Name, COUNT(*) AS Count, MAX(Confidence) AS MaxConfidence, MAX(Date) AS LastSeen
FROM detections
GROUP BY Sci_Name;
```
Lists read: `confirmed_species_list.txt` (bare sci names), `exclude_species_list.txt` and `whitelist_species_list.txt` (sci name = text before the first `_`).

Table `#speciesTable` (sortable by clicking headers; sort column/direction and the filter text persist in localStorage keys `speciesSortCol`, `speciesSortAsc`, `speciesFilter`): columns Common Name (link to `views.php?view=Recordings&species=<rawurlencode(Sci_Name)>`), Scientific Name (italic, linked to the info site), Stats (chart.svg -> `generateMiniGraph(this,'<Com_Name>',180)`), Count, Max Confidence (`round(*100,1)%`), Last Seen (sort key = unix time), Probability (`0.0000` placeholder, filled async), Confirmed, Excluded, Whitelisted (each a check.svg when set or an empty circle `.circle-icon` to add; clicking toggles), Delete (delete.svg), and a "Files on Disk" column inserted before Delete asynchronously. Toolbar: filter input `#q` (placeholder "Filter species… (name, scientific)") and `#matchCount` "shown / total".

Async loads:
- Probability: `scripts/config.php?threshold=0`, parses lines `^(.*)\s-\s([0-9.]+)\s*$`, maps both the full label and the sci-name part; cell text = value to 4 dp, green when `>= SF_THRESH` else red.
- Files on Disk: `scripts/species_tools.php?diskcounts=1` -> JSON `{<Common Name without apostrophes>: <int>}` parsed from `disk_species_count.sh` output lines `<n|n.nk> : <name>` (k suffix multiplied by 1000). The shell script counts non-png files matching `*YYYY-MM-DD*.*` under `By_Date/*/<sanitized name>`.

Endpoints:
- `?toggle=exclude|whitelist|confirmed&species=<id>&action=add|del`: for exclude/whitelist the id is `<Sci_Name>_<Com_Name>`; for confirmed it is `<Sci_Name>`. Adds the exact line if absent or removes exact matches; rewrites the file. Returns `OK`; the page reloads.
- `?getcounts=<Sci_Name>`: JSON `{"count": <db rows>, "files": <files found on disk (normal + shifted)>}`. File discovery per row: `By_Date/<Date>/<comname_safe>/<File_Name>` and `By_Date/shifted/...`, resolving symlinked dirs.
- `?delete=<Sci_Name>`: `sudo rm -r <dir>` for every directory that held a file for the species (i.e. the whole `By_Date/<date>/<comname_safe>` directory, including png files), then
  ```sql
  DELETE FROM detections WHERE Sci_Name = :name
  ```
  and removes the sci name from confirmed_species_list.txt. Returns `{"lines": N, "files": M}`. UI flow: confirm "Delete N detections and local audio and png files for <Com_Name>?", then alert "Deleted N detections and M files for <Com_Name>" and reload.

---

## 19. API: /api/v1 (scripts/api.php)

Routed from index.php when the path starts with `/api/v1/`. GET only (405 JSON `{"message":"Method Not Allowed"}` otherwise).

`GET /api/v1/image/<urlencoded Sci_Name>`: uses the configured provider (Flickr when `IMAGE_PROVIDER === 'FLICKR'`, else Wikipedia, even when IMAGE_PROVIDER is empty). 200 JSON:
```json
{"status":"success","message":"successfully image data from database","data":{"sci_name":...,"com_en_name":...,"image_url":...,"title":...,"id":...,"author_url":...,"license_url":...,"date_created":"YYYY-MM-DD","photos_url":...}}
```
404 body `Error 404! No image found!` when no image. Any other path: 404 `Error 404! No route found!`. Used by notifications.py (`http://localhost/api/v1/image/<sci>`) to fill `$image`.

---

## 20. Shared front-end components

### 20.1 Custom audio player (static/custom-audio-player.js, upstream main)
`initCustomAudioPlayers()` turns every `div.custom-audio-player[data-audio-src][data-image-src]` into: a hidden `<audio preload="none">`, a rounded wrapper showing the spectrogram `<img>` (removed if it 404s) with a 2 px dark vertical progress indicator that moves from 6% to 91% of the width (`LEFT_MARGIN_PERCENT 6`, `RIGHT_MARGIN_PERCENT 9`, matching sox's axes), a centered 64 px translucent play button overlay, a bottom control bar (15% height, blurred) with a range progress slider and a "dots" menu. Menu: Info (alert with Duration, Type (extension upper-cased), Size, Sampling Rate, Channels via fetch + decodeAudioData), Download (fetch blob, filename = last path segment), Gain (dB) options Off/6/12/18/24/30 mapped to gain 1/2/4/8/16/32, HighPass (Hz) Off/250/500/1000/1500, LowPass (Hz) Off/2000/4000/8000; these three persist in localStorage (`customAudioPlayerGain`, `customAudioPlayerFilterHigh`, `customAudioPlayerFilterLow`) and apply to all players. Clicking the spectrogram toggles play/pause (seeks only via the slider). Overlays show on hover/touch. Must be re-run after any AJAX insertion (pages call `initCustomAudioPlayers()`).

### 20.2 Mini graph (static/generateMiniGraph.js, upstream main)
`generateMiniGraph(elem, comname, days=30)`: GET `/todays_detections.php?comname=<enc>&days=<days>`, creates a fixed `div.chartdiv` (40% x 25% viewport, white, radius 5, shadow) positioned right of the clicked icon (or centered at 75% on narrow screens), vertically centered on it, with a Chart.js 2.x line chart: labels = dates (ticks show `MM-DD`, max 6), dataset "Detections" fill `#9fe29b`, border `#77c487` width 1, tension 0.3, point radius 1, plus a linear trendline (`rgba(55,99,64,0.5)`, solid, 1.5) from chartjs-plugin-trendline; title `Detections Over <days>d`, no legend, y begins at 0 integer ticks max 5. An "X" close button and a `<select>` with 30/180/360/720/1080 days re-renders. Any window scroll removes the popup.

### 20.3 Attribution dialog
`<dialog id="attribution-dialog">` (dialog-polyfill) with `#modalHeading` = `Photo: "<title>" Attribution`, `#modalText` = large preview image (max-height calc(100vh - 15rem), radius 5) + "Image link:", "Author link:", "License URL:" (URLs shortened to 32...16 chars when >= 48), Close, and "Blacklist this image" (hidden for Wikipedia; confirms, extracts the trailing digits of the photo link as the Flickr id, GETs `overview.php?blacklistimage=<id>`, reloads).

---

## 21. Notifications

### 21.1 species_notifier.sh (cron)
Copies `IDFILE` to a temp file, runs `update_species.sh` (`sqlite3 birds.db "SELECT DISTINCT(Com_Name) FROM detections" | sort > IDFILE`), diffs; if new lines appear, builds "New Species Detection: <names>" and, if `apprise.txt` is non-empty, sends `apprise -vv -t 'New Species Detected' -b "<msg>" --config=apprise.txt`. This is independent of the per-detection Apprise logic.

### 21.2 Per-detection Apprise (utils/notifications.py, upstream main)
Called once per species per analyzed file. `should_notify` returns false when apprise.txt is empty, when the common name (lower-cased, spaces removed) is in APPRISE_ONLY_NOTIFY_SPECIES_NAMES (exclusion), when APPRISE_ONLY_NOTIFY_SPECIES_NAMES_2 is non-empty and the name is not in it, or when the last notification for that species was less than APPRISE_MINIMUM_SECONDS_BETWEEN_NOTIFICATIONS_PER_SPECIES ago. Then up to three notifications: each detection (`reason="detection"`), first of the day (count today == 1, `reason="first time today"`), infrequent (count in the last 7 days between 1 and 5, `reason="only seen N times in last 7d"`). Template variables replaced in both title and body: `$sciname $comname $confidencepct $confidence $listenurl $friendlyurl $date $time $week $latitude $longitude $cutoff $sens $flickrimage $image $overlap $reason`. `$listenurl = <BIRDNETPI_URL or http://<hostname>.local>?filename=<File_Name>`, `$friendlyurl = [Listen here](<listenurl>)`. `$image`/`$flickrimage` resolve via `/api/v1/image/<sci>` and the image URL is also attached when the body contains `{` (template marker check). Apprise plugin dirs `~/.apprise/plugins` and `~/.config/apprise/plugins`.

### 21.3 BirdWeather (utils/reporting.py)
If BIRDWEATHER_ID set and a file has detections: convert the whole raw wav to FLAC in memory, `POST https://app.birdweather.com/api/v1/stations/<ID>/soundscapes?timestamp=<file iso8601>` (Content-Type audio/flac), take `soundscape.id`, then per detection `POST https://app.birdweather.com/api/v1/stations/<ID>/detections` JSON `{timestamp, lat, lon, soundscapeId, soundscapeStartTime: start, soundscapeEndTime: stop, commonName, scientificName, algorithm: '2p4' | 'alpha', confidence}`.

### 21.4 Heartbeat
`GET HEARTBEAT_URL` after each file when set.

---

## 22. External services summary

| Service | Where | Purpose |
|---|---|---|
| Wikipedia REST summary + Commons imageinfo | common.php Wikipedia class, api.php | Species image + attribution |
| Flickr REST (photos.search, photos.getInfo, photos.licenses.getInfo, people.findByEmail) | common.php Flickr class, stats.php gallery | Species images |
| wikipedia.org/wiki/<Sci_Name> | links on every detection | Info link |
| allaboutbirds.org/guide/<English_Name> or ebird.org/species/<code>?siteLanguage= | get_info_url | Info link |
| eBird import PDF link | history.php dialog | Docs |
| app.birdweather.com API | reporting.py | Upload soundscapes and detections |
| Apprise (90+ services) | notifications.py, weekly_report.sh, species_notifier.sh | Push notifications |
| GitHub (Nachtzuster/BirdNET-Pi) | views.php git status, system_controls commit link, logo link | Update check |
| latlong.net, flickr API key page, kahst discussion, mcguirepr89 wiki | Settings page links | Docs |
| ip-api.com | installer only | Initial lat/lon |

---

## 23. Style (homepage/style.css and static/dark-style.css)

No CSS custom properties are defined; colors are literal. Font: `@font-face 'Roboto Flex'` from `static/RobotoFlex-Regular.ttf`; `* { font-family: 'Roboto Flex', sans-serif; box-sizing: border-box; font-size: medium }`.

Light palette:
- Page background `rgb(119,196,135)` (#77C487, also the daily chart facecolor and `.sortbutton` background)
- Nav bar / banners / tr background `rgb(159,226,155)` (#9fe29b, also mini-graph fill, `#showpassword`, `#newrtspstream`)
- Cells, hover, buttons `rgb(219,255,235)` (#dbffeb)
- Accent `#04AA6D` (active nav, slider thumb); link hover blue; update badge `#c8191a`; `pre.bash` black on white; dialog backdrop striped `rgba(24,194,236,0.2/0.3)` with 1 px blur; text black.

Dark palette (dark-style.css deltas): body `#1a1a1a`; cells/modal/nav `#2b2b2b`; buttons/hover/sortbutton/loadmore/legacyview/brbanner/tr `#3b3b3b`; button hover `#4b4b4b`; sortbutton hover `#AAAAAA`, active `#777777`; text `#f5f5f5`; link hover white; slider thumb `#f5f5f5`; shadows become white-tinted; logo gets a white drop shadow; images get `opacity: 0.7`; dialog backdrop `rgba(30,50,80,...)` blur 3 px; `dt` color `#b2b2b2`; selects `#333`/white; `pre.bash` `#2b2b2b`.

Structural classes used by pages: `.banner`, `.logo`, `.stream`, `.topimage`, `.centered`, `.topnav` (+`.responsive`, `.icon`, `.button-hover`, `.active`), `.views`, `.updatenumber`, `.overview`, `.overview-stats`, `.left-column`, `.center-column` (hidden above 1290 px, flex below), `.right-column`, `.chart`, `.new_species`, `.rare_species`, `.viewdb`, `#todaystats`, `#detections_table`, `#recent_detection_middle_td`, `.centered_image_container` + `img.img1` (absolute, right:110%, 95% height, radius 5), `#birdimage`, `.copyimage` (absolute top 7 right 7, 25 px), `.copyimage-mobile`, `.relative`, `.custom-audio-player`, `.chartdiv`, `.stats`, `.column`, `.column.center`, `.brbanner`, `.play`, `td.spec`, `.sortbutton` (+`.active`), `button.loadmore`, `button.legacyview`, `#searchterm`, `.history.centered`, `.settings`, `.settingstable`, `.plaintable`, `.testbtn` (white background inputs/selects), `.float`, `.disabled`, `.slidecontainer`, `.slider`, `.callout.callout-warning`, `#showpassword`, `#newrtspstream`, `.customlabels` + `.column1/.column2/.column3/.smaller`, `.systemcontrols`, `.servicecontrols`, `.btn-group-center`, `pre.bash`, `pre#timer.bash`, `.modal`, `.modal-content`, `#labelDropdown`, `dialog`, `dl/dt/dd` (dd prefixed with ": "), `.tooltip`, `.fade-in`, `.circle-icon`, `.toolbar`, `#speciesTable`.

Responsive breakpoints: 1290 px (switch to center-column stats), 1000 px (collapse nav into hamburger, species list columns stack, hide banner image), 800 px (full-width tables, hide `.left`, iframe height 83%), 768 px (modal width), 500 px (`#recent_detection_middle_td` 66%).

Layout constants: iframe height 88% fixed; banner height 7%; `.topnav` 65% width centered with radius 4; tables centered with `box-shadow 0 0 17px 1px rgba(0,0,0,.10)`, radius 3; td padding 10, th padding 12.

---

## 24. Disk management scripts that touch files the UI references (upstream main)

- `disk_check.sh` (cron): when `df` usage of EXTRACTED >= PURGE_THRESHOLD: in purge mode curls `views.php?view=Species%20Stats` (to refresh the auto section of disk_check_exclude.txt), aborts if the file lacks `##start`, deletes files under `By_Date/*/*/*` in directory order, skipping any path listed in disk_check_exclude.txt, until `total files / number of date dirs` files are removed; deletes empty dirs older than 90 days; if still full, `rm -rf PROCESSED/*`. In keep mode runs `stop_core_services.sh`. DB rows are never removed by purging, which is why the Recordings page checks file existence and the Species Management page shows "Files on Disk".
- `clear_all_data.sh`: stops recording/analysis, removes RECS_DIR, IDFILE, BirdDB.txt, recreates `EXTRACTED`, `EXTRACTED/By_Date`, `EXTRACTED/Charts`, `PROCESSED`, re-links homepage files and scripts into EXTRACTED, runs `createdb.sh`, restarts services.
- `backup_data.sh` / `restore.php` / `read_chunks.sh`: tar-based full data backup/restore (DB + BirdSongs), chunked upload through a FIFO.

---

## 25. Gaps, quirks, and inferred behavior

1. The staged copy has no `scripts/utils/`, `homepage/static/`, `homepage/images/`, `birdnet.conf` template, or helper shell scripts; everything cited as "(upstream main)" was fetched from GitHub main on 2026-10-14 and may be newer than the staged PHP. Notably upstream analysis.py now lists extra models (`Perch_v2`, `BirdNET-Go_classifier_20250916`) in its test fixture, while the staged config.php only offers the two BirdNET models.
2. Bare-column semantics: every "species summary" query relies on SQLite returning the Date/Time/File_Name of the MAX(Confidence) row. D1 (also SQLite) preserves this, but an explicit window/subquery is safer.
3. `fetch_all_detections(..., 'occurrences')` uses `ORDER BY COUNT(*) DESC` without GROUP BY; the result order is effectively undefined (single aggregate row behavior in SQLite returns one row). In practice the species detail page only offers `date` and `confidence`, so this branch is reachable only by crafting the URL.
4. `todays_detections.php?comname=` zero-fills exactly 31 days regardless of `days`, and uses UTC `DATE("now")` while the rest of the app uses `'localtime'`.
5. Weekly report "first time" rows print `$scount` (last loop value) rather than the species' own count.
6. Kiosk auto-refresh fires only once (setTimeout, 60 s), not periodically.
7. Advanced-settings XHR calls from the Spectrogram page reset SILENCE_UPDATE_INDICATOR, AUTOMATIC_UPDATE, RAW_SPECTROGRAM to 0 and RARE_SPECIES_THRESHOLD to 30 because those keys are absent from the request.
8. `ACTIVATE_FREQSHIFT_IN_LIVESTREAM` is not in the installer template; the preg_replace write only works if the key already exists in birdnet.conf.
9. history.php's eBird export button is commented out; the endpoint remains.
10. `Combo2-*.png` is never generated in this fork (daily_plot only produces the "All" Combo chart); history.php always shows "No Charts For <date>" for the second image.
11. The "Today" audio path in todays_detections.php uses the server's current date, not the row's Date (identical for today's rows).
12. `play.php?deletefile` deletes with `LIMIT 1`, which requires the SQLITE_ENABLE_UPDATE_DELETE_LIMIT build option.
13. `index.php` and `views.php` sanitize `$_GET` with the deprecated `FILTER_SANITIZE_STRING`, which HTML-encodes quotes; pages decode with `htmlspecialchars_decode(..., ENT_QUOTES)` before SQL/file use. Species names with apostrophes (e.g. "Bewick's Wren") therefore work only where that decode happens; directory names strip the apostrophe entirely.
14. `stats.php` always rewrites disk_check_exclude.txt on view, even for anonymous visitors. Replicating "best recordings are protected from purge" requires a server-side equivalent.
15. phpSysInfo, Adminer, Tiny File Manager, gotty log/terminal, and the icecast live stream are host-level tools with no equivalent in a Cloudflare-hosted UI unless the Pi keeps serving them.

Data a Cloudflare port needs the Pi to push (minimum): each `detections` row as inserted; each extracted clip at `By_Date/<Date>/<comname_safe>/<File_Name>` and its `.png`; the daily `Charts/Combo-<date>.png` (or recompute server-side from D1); the live `spectrogram.png` and the StreamData `*.wav.json` sidecars if the Overview "Currently Analyzing" and live Spectrogram overlays are to be kept; `labels.txt` (for pickers and re-identification); the three species list files and confirmed list; `disk_check_exclude.txt` state (or move purge protection to metadata); `blacklisted_images.txt`; `apprise.txt` and `body.txt` if settings remain editable from the cloud; and the config key/value set in section 4.
