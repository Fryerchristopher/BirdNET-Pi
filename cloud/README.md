# BirdNET-Pi Cloud

Run the BirdNET-Pi website on Cloudflare and leave the Pi as a collector.

The Pi keeps doing what it is good at: recording, running BirdNET, extracting
clips and spectrograms. A small agent pushes every detection and file to a
Cloudflare Worker, which stores rows in D1 and media in R2 and serves the
site. The Pi never accepts an inbound connection and never serves a page.

```
Raspberry Pi                                   Cloudflare
+---------------------------+   HTTPS, bearer   +------------------------------+
| BirdNET-Pi (unchanged)    |  ---------------> | Worker  /ingest/*  (push)     |
|   birds.db, By_Date/...   |                   |         /api/v1/*  (read)     |
| cloud_agent.py            |  <--------------  |         /api/v1/admin/* (ops) |
|   push rows + files       |   commands        |         /media/*   (R2)       |
|   poll commands           |   (pulled)        |         /           (web UI)  |
+---------------------------+                   |  D1 (rows)   R2 (audio, png)  |
                                                +------------------------------+
```

Every page of the original site is here: Overview, Today's Detections (and
kiosk mode), Spectrogram, Best Recordings, Species Stats, Daily Charts,
Weekly Report, Recordings, and the Tools pages that still make sense once the
Pi is only a collector (settings, species management, species lists, service
controls, command log). Deleting, re-identifying, locking and pitch-shifting
a recording still work: the cloud queues a command and the agent carries it
out on the Pi. New since the Pi version: an optional "Ask BirdNET-Pi" chat
answered by Claude through a Cloudflare AI Gateway.

## Design is separate from function

The Worker exposes a documented JSON API (`docs/API.md`). Two front ends ship
with the repo, and `[assets] directory` in `worker/wrangler.toml` picks one:

- `web-field-journal/` (default): the **Field Journal** design, a living field
  guide to one place. Plates, a this-week home page, a who-sang-when dot
  grid, a calendar archive, light and dark. The handoff it implements is in
  `docs/field-journal/`.
- `web/`: a straight port of the BirdNET-Pi pages, with every color and font
  coming from a theme file (`web/css/themes/*.css`, see `docs/THEMING.md`).

You can use either as is, add a theme to the classic UI, or replace the
directory with your own design on the same API.

## Layout

```
cloud/
  README.md            this file
  docs/                ARCHITECTURE, DEPLOY, API, THEMING, php-inventory (what was ported)
  db/schema.sql        D1 schema (idempotent); seed.sql for local dev
  worker/              Cloudflare Worker (Hono, TypeScript): API, ingest, media, admin, chat, cron
  web-field-journal/   the Field Journal front end (default)
  web/                 the classic UI: static pages, js/, css/base.css, css/themes/
  pi/                  cloud_agent.py and install.sh for the Pi
```

## Quick start

See `docs/DEPLOY.md`. The short version:

```
cd cloud/worker && npm install
wrangler login                           # the Cloudflare account that will host the site
wrangler d1 create birdnet-pi            # paste the id into wrangler.toml
wrangler r2 bucket create birdnet-pi-media
wrangler secret put INGEST_TOKEN
wrangler secret put ADMIN_TOKEN
npm run db:schema:remote
npm run deploy
# on the Pi, in a folder of its own so ~/BirdNET-Pi keeps tracking upstream:
git clone -b cloud https://github.com/Fryerchristopher/BirdNET-Pi.git ~/birdnet-cloud
bash ~/birdnet-cloud/cloud/pi/install.sh https://birds.example.com <INGEST_TOKEN>
```

Upgrading an existing deployment: run any new files in `db/migrations/` against
the database before deploying the new Worker (DEPLOY.md lists which ones).
To serve the site on your own hostname, add a custom domain route to
`wrangler.toml` (see DEPLOY.md); keep `workers_dev = true` if anything still
uses the `*.workers.dev` address.

### Free plan or Workers Paid

A small station fits the free plan. Since September 2026 Cloudflare enforces
D1's free daily limits (5 million rows read, 100,000 rows written, reset at
midnight UTC); past them, queries fail until the reset, so the site errors.
The first sync from a Pi with a long history writes far more than 100,000
rows, so either let it spread over several days or use Workers Paid ($5 a
month), which the Dorrington station uses. R2 is free to 10 GB of clips, then
$0.015 per GB a month.

## BirdWeather

Nothing here touches the Pi's BirdWeather upload. `utils/reporting.py` keeps
posting soundscapes and detections to app.birdweather.com whenever
`BIRDWEATHER_ID` is set in `birdnet.conf`; the agent neither reads nor writes
that file. Admin > Station shows whether the id is set.

## Status

Live since 2026-10-14 at [birds.dorringtonbirds.com](https://birds.dorringtonbirds.com),
serving the Dorrington station: about 690,000 detections back to March 2024 and
19 GB of clips in R2, with the Pi pushing new detections every minute or so.
The Field Journal pages answer in well under a second (an hourly summary table,
`db/migrations/0003_hourly_counts.sql`, and edge caching). The classic `web/` UI is smoke-tested against
`wrangler dev` with seeded data but not run in production. The model path of
Ask BirdNET-Pi follows the working implementation on
weather.dorringtonbirds.com but has not been run with a real key from this
tree.
