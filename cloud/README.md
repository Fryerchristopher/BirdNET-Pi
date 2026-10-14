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

The Worker exposes a documented JSON API (`docs/API.md`). The default UI in
`web/` is plain HTML, CSS and JavaScript against that API, with every color
and font coming from a theme file (`web/css/themes/*.css`, see
`docs/THEMING.md`). You can:

1. use the default UI as is, picking a bundled theme in Admin > Settings;
2. add your own theme file (a few dozen CSS variables) and pick it;
3. replace `web/` entirely with your own design on the same API.

## Layout

```
cloud/
  README.md            this file
  docs/                ARCHITECTURE, DEPLOY, API, THEMING, php-inventory (what was ported)
  db/schema.sql        D1 schema (idempotent); seed.sql for local dev
  worker/              Cloudflare Worker (Hono, TypeScript): API, ingest, media, admin, chat, cron
  web/                 default UI: static pages, js/, css/base.css, css/themes/
  pi/                  cloud_agent.py and install.sh for the Pi
```

## Quick start

See `docs/DEPLOY.md`. The short version:

```
cd cloud/worker && npm install
wrangler d1 create birdnet-pi            # paste the id into wrangler.toml
wrangler r2 bucket create birdnet-pi-media
wrangler secret put INGEST_TOKEN
wrangler secret put ADMIN_TOKEN
npm run db:schema:remote
npm run deploy
# on the Pi:
bash ~/BirdNET-Pi/cloud/pi/install.sh https://birds.example.com <INGEST_TOKEN>
```

## Status

Framework complete and smoke-tested locally against `wrangler dev` with
seeded data (API, ingest, media with range requests, admin mutations, the
command round trip, theme switching, every page rendering without errors).
Not yet exercised against a live Pi or a deployed Worker. The model path of
Ask BirdNET-Pi follows the working implementation on
weather.dorringtonbirds.com but has not been run with a real key from this
tree.
