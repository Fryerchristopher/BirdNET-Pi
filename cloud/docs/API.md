# API

All responses are JSON unless noted. Dates are `YYYY-MM-DD`, times
`HH:MM:SS`, both in the station's local time. Every public endpoint accepts
`?station=<id>` (default `default`).

A detection row looks like:

```json
{
  "id": 9, "date": "2026-10-14", "time": "10:00:00",
  "sci_name": "Cyanocitta stelleri", "com_name": "Steller's Jay", "confidence": 0.8123,
  "file_name": "Stellers_Jay-81-2026-10-14-birdnet-10:00:00.mp3",
  "com_name_safe": "Stellers_Jay",
  "media_key": "by_date/2026-10-14/Stellers_Jay/Stellers_Jay-81-2026-10-14-birdnet-10:00:00.mp3",
  "has_audio": 1, "has_png": 1, "has_shifted": 0, "locked": 0, "on_pi": 1,
  "lat": 38.3, "lon": -120.3, "cutoff": 0.7, "week": 42, "sens": 1.25, "overlap": 0
}
```

Audio is at `/media/<media_key>`, the spectrogram at `/media/<media_key>.png`,
a pitch-shifted copy (when `has_shifted`) at `/media/by_date/shifted/...`.

## Public: `/api/v1`

| Endpoint | Returns |
|---|---|
| `GET /site` | `settings` (public subset), `station` (timezone, online, last push, analyzing_now, versions, disk, backlog, config snapshot), `today`, `admin` (whether the caller is authenticated), `flickr_enabled` |
| `GET /summary` | `total`, `today`, `last_hour`, `species_today`, `species_total`, `date` |
| `GET /detections` | paged list. Filters: `date` (`YYYY-MM-DD` or `today`), `from`, `to`, `sci`, `com`, `q` (free text; prefix `not ` negates), `sort=date|confidence`, `limit` (max 500), `offset`, `locked=1`, `available=1` (has audio). Returns `items`, `total`, `limit`, `offset` |
| `GET /detections/recent?limit=5` | newest detections |
| `GET /detections/latest` | newest detection that has a spectrogram (`?any=1` ignores that) |
| `GET /detections/:file_name` | one row |
| `GET /species` | one row per species with `count`, `max_confidence`, `first_date`, `last_date` and the best recording (`best_date`, `best_time`, `best_file_name`, `best_media_key`, `best_has_audio`, `best_has_png`). `sort=alphabetical|occurrences|confidence|date`, optional `date` |
| `GET /species/manage` | species management table (counts, first/last seen, clips in cloud and on Pi, locked, list membership) |
| `GET /species/:sci/best` | best detection row plus `count` |
| `GET /species/:sci/history?days=30` | `[{date, count}]`, zero-filled, oldest first |
| `GET /species/:sci/links` | `info`, `info_title`, `wikipedia`, `com_en_name` |
| `GET /species/:sci/info` | 302 to the configured info site |
| `GET /species/:sci/gallery` | up to 15 Flickr photos (empty without a key) |
| `GET /today/highlights` | `new_species` (never seen before today) and `rare_species` (not seen for more than `rare_species_threshold` days, with `days_ago`) |
| `GET /daily?date=` | `total`, `species[]` each with `total`, `max_confidence`, `hours[24]`; `prev`, `next`, `is_today`, `chart_image` (if the Pi pushed one) |
| `GET /dates` | `[{date, count, species, with_audio}]` newest first |
| `GET /weekly?end=` | the weekly report: `week`, `start`, `end`, totals with `*_change_pct` (null = no prior data), `top` (10), `first_seen`, `all` |
| `GET /stats?from=&to=&sci=&top=` | Species Stats data: `species` (top N), `species_total`, `hours[24]`, `dates[]`, `total`; with `sci`: `confidence {max, median, count}`, `quarter_hours [{date, slot 0..95, n}]`, `recordings` (newest 200) |
| `GET /live` | `analyzing_now`, `spectrogram {url, uploaded}`, `live {file_name, timestamp, delay, detections[], age_seconds}` |
| `GET /image/:sci` | `{status, data: {image_url, title, author_url, license_url, photos_url, provider, image_id}}`, 404 when none |
| `GET /labels` | the model's label list `[{sci_name, com_name, com_en_name}]` |
| `GET /lists` | `{include, exclude, whitelist, confirmed}` each `[{sci_name, com_name}]` |
| `GET /ebird.csv?date=&location=&state=&country=&protocol=&num_observers=&dist_traveled=&notes=` | eBird record-format CSV (text/csv) |
| `POST /chat {question}` | `{kind: exact|model|capped|blocked|error|disabled, answer}` |

## Admin: `/api/v1/admin` (bearer `ADMIN_TOKEN` or Cloudflare Access)

| Endpoint | Effect |
|---|---|
| `GET /me` | 200 when authenticated |
| `GET /settings`, `PUT /settings {key: value}` | read or update settings (unknown keys ignored) |
| `POST /detections/:file/delete` | queues `delete_file` (immediate when the Pi no longer has it) |
| `POST /detections/:file/lock`, `/unlock` | sets `locked` and queues the Pi-side exclude-list edit |
| `POST /detections/:file/shift`, `/unshift` | queues a pitch-shifted copy (the agent uploads it) or its removal |
| `POST /detections/:file/reidentify {sci_name, com_name}` | queues `reidentify` (label must exist) |
| `POST /species/:sci/delete` | queues `delete_species` |
| `POST /lists/:list {action: add|del, sci_name, com_name?}` | edits include/exclude/whitelist/confirmed and queues `sync_lists` |
| `POST /images/blacklist {image_id}` | hides a Flickr image |
| `GET /commands` | last 100 commands with status and result |
| `POST /commands {kind, service?, name?}` | `restart_service|stop_service|start_service` (allow-listed services), `sync_lists`, `resync`, `run` (`disk_species_count`, `update_species`) |

Settings keys: `site_name`, `site_url`, `theme`, `image_provider`
(`none|wikipedia|flickr`), `flickr_filter_email`, `info_site`
(`allaboutbirds|ebird`), `language`, `rare_species_threshold`,
`recording_length`, `stream_url`, `public_admin_links`, `chat_enabled`,
`chat_model`, `chat_intro`, `chat_daily_budget`, `chat_per_ip_per_hour`,
`chat_per_ip_per_day`, `notify_title`, `notify_each_detection`,
`notify_first_of_day`, `notify_new_species`, `notify_weekly_report`,
`notify_min_seconds_per_species`, `notify_exclude_species`,
`notify_only_species`.

## Ingest: `/ingest` (bearer `INGEST_TOKEN`)

| Endpoint | Body |
|---|---|
| `POST /detections` | `{station?, rows: [Pi detections row with the original column names]}`, max 500 |
| `PUT /media/<key>` | raw bytes; `Content-Type` set. Keys under `by_date/`, `charts/`, `live/`, `custom/` |
| `POST /status` | `{name, timezone, lat, lon, analyzing_now, pi_version, agent_version, disk_used_pct, backlog_files, config}` |
| `POST /live` | the StreamData `*.wav.json` sidecar |
| `POST /labels` | `{labels: ["Sci_Common", ...] or [{sci_name, com_name, com_en_name}]}` |
| `POST /lists` | `{include: [...], exclude: [...], whitelist: [...], confirmed: [...]}` (seed once) |
| `POST /purged` | `{file_names: [...]}` |
| `GET /commands?max=10` | pending commands, marked taken |
| `POST /commands/:id` | `{status: done|failed, result}` |

Command kinds and payloads the agent must handle: `delete_file {file_name, path}`,
`delete_species {sci_name}`, `reidentify {file_name, path, sci_name, com_name, newname}`
(result `{new_file_name}`), `lock|unlock {file_name, path}`, `shift {file_name, path, media_key}`,
`unshift {file_name, path}`, `sync_lists {include, exclude, whitelist, confirmed}`,
`restart_service|stop_service|start_service {service}`, `run {name}`, `resync {}`.
`path` is `<date>/<com_name_safe>/<file_name>`, relative to `By_Date`.

## Media: `/media/<key>`

Streams the R2 object with `Accept-Ranges` and 206 responses for `Range`
requests, so `<audio>` can seek. Immutable cache headers except under `live/`.

## Journal: `/api/v1/journal` (page-shaped, used by the Field Journal UI)

| Endpoint | Returns |
|---|---|
| `GET /site` | site copy from settings, station online state and last push (local time), today's sun times |
| `GET /home` | this week: `hero`, `mosaic` (most, runner_up, rarest), `plates[]` (week and today counts, 12 monthly levels 0..4, presence line, best clip), `new_this_week`, `quiet_this_week`, `today_stats`, `comparison`, `conditions`, `sun` |
| `GET /species` | every species with `week` (last 7 days), `total`, `first_date`, `last_date`, `slug` |
| `GET /species/:slug` | facts, `levels`, `presence`, `hours[24]` all time, `usual`, `best[]` (6 clips by confidence), `more_this_week`, `links` |
| `GET /photos/:sci` | `main` (with `credit {text, link, license_url}`) and up to 3 `gallery` images (Flickr only) |
| `GET /day/:date` | `today` or a date: `stats`, `sun`, `conditions` (today only, from the weather API), `comparison`, `species[]` with `hours[24]`, `max_cell`, `now_hour` |
| `GET /clips?date=&sci=&hour=&limit=` | clips for one species in one hour |
| `GET /recording/:file_name` | one clip plus `conditions` at that moment (from the weather API series) |
| `GET /archive/:yyyy-mm` | per-day species and detection counts, month navigation |
| `GET /archive/day/:date` | top 5 species and stats for the side panel |
| `GET /live` | species heard in the last 15 minutes, the last 4 distinct species as a fallback, stream URL, latest spectrogram |

Monthly levels: average detections per calendar month across the years the
station was active in that month, quantized to 1..4 against the species'
own maximum (0 = absent). Presence line: "Here all year" when every month is
above zero, else the longest run of present months wrapping December to
January. Comparison: today's count up to the current time against yesterday
at the same time, and against the 25th to 75th percentile of the same
calendar window (plus or minus 7 days) in earlier years.
