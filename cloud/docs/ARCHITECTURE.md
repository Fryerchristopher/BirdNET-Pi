# Architecture

## Goals

1. The Pi is a collector. It records, analyzes, extracts, and pushes. It does
   not serve a website, does not need a tunnel for inbound traffic, and does
   not need to be reachable at all for the site to work.
2. Function and design are separate. The Worker owns data and behavior; the
   UI is a replaceable static client of a documented API.
3. Nothing BirdNET-Pi does today changes. The agent is additive: the PHP
   site, Apprise, BirdWeather and the disk purge keep working on the Pi.
4. One Worker, one D1, one R2. No Pages project, no queue, no Durable
   Objects. Cheap and easy to reason about.

## Pieces

### Worker (`worker/`)

Hono app with five route groups:

| Prefix | Who | What |
|---|---|---|
| `/ingest/*` | the Pi agent (bearer `INGEST_TOKEN`) | upsert detections, upload media, status, live sidecar, labels, lists, purged files, command poll and ack |
| `/api/v1/*` | anyone | read-only JSON for every page |
| `/api/v1/admin/*` | admins | settings, mutations (become commands), lists, image blacklist |
| `/api/v1/chat` | anyone, rate-limited | Ask BirdNET-Pi |
| `/media/*` | anyone | R2 objects with Range support |

Everything else is served from `web/` by Workers Static Assets. `/theme.css`
is the one dynamic stylesheet: it returns `web/css/themes/<theme>.css` for
the theme chosen in settings (`?theme=` previews another).

Two cron triggers: hourly housekeeping (expire the image cache, requeue
commands a dead agent took but never acked) and the Monday weekly-report
webhook.

### D1 (`db/schema.sql`)

`detections` keeps the Pi's columns (lower-cased) plus what the cloud needs:
`com_name_safe`, `media_key`, the `has_audio`/`has_png`/`has_shifted` flags,
`locked` (purge protection) and `on_pi` (0 once the Pi reports the local file
gone). The natural key is `(station_id, file_name)`, so re-pushing is safe.

Every table has a `station_id`. A normal install only ever uses `default`;
multi-station needs no migration later.

`commands` is the only channel back to the Pi. The agent polls it. Side
effects that must wait for the Pi (deleting rows and R2 objects, renaming
after re-identification) are applied when the ack arrives.

### R2

Keys mirror the Pi's layout so an agent can derive them without a lookup:

```
by_date/<date>/<com_name_safe>/<file_name>        clip
by_date/<date>/<com_name_safe>/<file_name>.png    spectrogram
by_date/shifted/<date>/<com_name_safe>/<file_name>
charts/Combo-<date>.png                           optional, from chart_viewer.service
live/spectrogram.png                              "currently analyzing"
```

### Pi agent (`pi/cloud_agent.py`)

Standard-library Python, one systemd service. Loop every 10 s:

1. push rows with `rowid` above the high-water mark (batches of 200);
2. upload audio and PNG for new rows (retries while extraction catches up);
3. push the live spectrogram, newest `StreamData/*.wav.json`, today's Combo chart when their mtime changes;
4. heartbeat once a minute (timezone, lat/lon, analyzing_now, disk, backlog, git commit, a config subset; labels and lists when their files change);
5. poll and execute commands;
6. once a day, report which clips the purge removed.

State is one JSON file (`~/BirdNET-Pi/cloud_agent_state.json`). Deleting it
re-pushes everything; the cloud upserts, so that is harmless.

### Default UI (`web/`)

Static HTML shells, one ES module per page, `js/app.js` for the shared
runtime (API client, header and nav, detection card, spectrogram audio
player, mini trend graph, attribution dialog, admin actions, Ask panel).
Chart.js is loaded from cdnjs only on pages that chart. No build step.

## What moved where

| On the Pi | In the cloud |
|---|---|
| PHP pages reading birds.db | `/api/v1/*` + `web/` |
| Streamlit (plotly_streamlit.py) | `/api/v1/stats` + `web/js/stats.js` |
| daily_plot.py PNG | `/api/v1/daily` drawn client-side (the PNG is still accepted if the Pi pushes it) |
| wikipedia.db / flickr.db | `species_images` table |
| disk_check_exclude.txt manual section | `detections.locked`, mirrored back by lock/unlock commands |
| include/exclude/whitelist/confirmed text files | `species_lists`, mirrored back by sync_lists |
| Caddy basic auth | Cloudflare Access or `ADMIN_TOKEN`; public pages are public |
| birdnet.conf web-facing keys (site name, image provider, info site, color scheme, rare threshold) | `settings` table |
| icecast live stream | stays on the Pi; publish it through a Tunnel and set `stream_url` |

Deliberately not ported: phpSysInfo, Adminer, Tiny File Manager, the web
terminal and the gotty log. They are host tools for a machine you are logged
into; SSH does that job.

## Things to know

* "Today" is the station's local date (`stations.timezone`, pushed by the
  agent), never UTC.
* The PHP species summaries relied on SQLite's bare-column rule to return the
  best recording's date and file name. The D1 queries pick the best row
  explicitly with `ROW_NUMBER()`.
* Re-identification sets `confidence = 0`, as the Pi does; the UI shows a
  "manual" pill.
* The weekly report window is computed exactly as `weekly_report.php` does
  (the Sunday-to-Saturday week before the most recent Sunday).
