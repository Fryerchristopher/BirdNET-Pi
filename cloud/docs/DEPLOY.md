# Deploying

You need a Cloudflare account (the free plan is enough for one station), a
domain on Cloudflare if you want a custom hostname, Node 18+ on the machine
you deploy from, and a Pi already running BirdNET-Pi.

## 1. Worker, database, bucket

```
cd cloud/worker
npm install
npx wrangler login

npx wrangler d1 create birdnet-pi
#   -> copy database_id into wrangler.toml ([[d1_databases]])
npx wrangler r2 bucket create birdnet-pi-media

npx wrangler secret put INGEST_TOKEN     # any long random string; the Pi gets the same value
npx wrangler secret put ADMIN_TOKEN      # for ADMIN_AUTH = "token" (default)
npx wrangler secret put IP_SALT          # any random string (chat rate limiting)

npm run db:schema:remote
npm run deploy
```

`wrangler deploy` prints the `*.workers.dev` URL. To use your own hostname
(its zone must be in the same Cloudflare account), add to `wrangler.toml`

```
routes = [{ pattern = "birds.example.com", custom_domain = true }]
workers_dev = true
```

and deploy again. Wrangler turns the `*.workers.dev` address off once routes
are set unless `workers_dev = true` is there. If the hostname already has a
DNS record (an old site, a tunnel), delete it first or the custom domain is
refused. The dashboard does the same thing under Workers & Pages >
birdnet-pi-cloud > Settings > Domains & Routes.

Generate tokens with `openssl rand -hex 32`.

## 2. The Pi

```
git clone -b cloud https://github.com/Fryerchristopher/BirdNET-Pi.git ~/birdnet-cloud
bash ~/birdnet-cloud/cloud/pi/install.sh https://birds.example.com <INGEST_TOKEN>
journalctl -fu birdnet_cloud_agent
```

Keep the clone separate from `~/BirdNET-Pi`, which should stay on the
upstream branch so BirdNET-Pi's own updater keeps working. `install.sh`
copies the agent into `~/BirdNET-Pi/scripts/`; those updates leave it alone.

The first run pushes the whole history: rows in batches of 200 and then the
clips, forty per cycle. A station with tens of thousands of clips takes a
while; the site is usable from the first batch. `UPLOAD_MEDIA=0` in
`/etc/birdnet/cloud_agent.conf` pushes rows only.

Nothing on the Pi is changed except the new service and config file. The
PHP site keeps running; turn it off later if you want (`sudo systemctl
disable --now caddy`), or keep it for local use.

## 3. Settings

Open `https://<your site>/admin/`, sign in with `ADMIN_TOKEN`, and set the
site name, tagline and footer blurb (the Field Journal reads these), the
photo source, and the weather links if you have a weather station. The
station's timezone and location come from the Pi automatically.

Photos: Wikipedia is the default and needs no key. Flickr gives named
photographer credits and the species page gallery; `wrangler secret put
FLICKR_API_KEY` (the same key as on the Pi's Settings page), then choose
Flickr as the source. Existing databases need `db/migrations/0002_species_images_author.sql`
once; fresh installs do not.

Upgrading a database created before 2026-10-18: run
`wrangler d1 execute birdnet-pi --remote --file=../db/migrations/0003_hourly_counts.sql`
before deploying the new Worker. It adds the `hourly_counts` table the Field
Journal reads, the triggers that keep it current, and fills it from the
existing detections (a few seconds for 700k rows). Safe to run again.

BirdWeather uploads stay on the Pi (see README) and need nothing here.

## Auth

`ADMIN_AUTH` in `wrangler.toml`:

* `token` (default): the admin UI asks for `ADMIN_TOKEN` once per browser
  session and sends it as a bearer. Simple, fine for one person.
* `access`: put a Cloudflare Access application in front of `/admin*` and
  `/api/v1/admin/*` and set `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`. The Worker
  verifies the Access JWT; the login box never appears. Use this for a team
  or for SSO.
* `open`: no auth. `wrangler dev` only.

Public pages are public, as on a stock BirdNET-Pi without a password. To
protect the whole site, put Access in front of `/*` as well.

## Live audio

The live stream is the one thing that cannot leave the Pi. To keep it:

1. keep `livestream.service` and `icecast2` running on the Pi;
2. publish `http://localhost:8000/stream` with a Cloudflare Tunnel
   (`cloudflared tunnel ... --url http://localhost:8000`) on a hostname such
   as `stream.example.com`, optionally behind Access;
3. set `stream_url` in Admin > Settings. The header gains a Live audio
   button and the Spectrogram page switches to live mode.

Icecast must send `Access-Control-Allow-Origin` for the live spectrogram
analyser to read the audio; add it under `<http-headers>` in `icecast.xml`.

## Ask BirdNET-Pi (optional)

1. Create an AI Gateway (AI > AI Gateway > Create). Note the account id and
   gateway name.
2. In `wrangler.toml` set
   `AI_GATEWAY_URL = "https://gateway.ai.cloudflare.com/v1/<ACCOUNT_ID>/<GATEWAY>/anthropic"`.
3. Either `wrangler secret put ANTHROPIC_API_KEY`, or store the Anthropic key
   in the gateway (BYOK) and turn on gateway authentication, then
   `wrangler secret put AI_GATEWAY_TOKEN`.
4. Deploy, then turn on **Ask BirdNET-Pi** in Admin > Settings. The default
   model is `claude-haiku-5-5`; the daily site-wide cap and per-visitor
   limits are settings too.

Common questions (counts today, latest detection, is the station online)
are answered from the data without calling the model.

## Notifications (optional)

`wrangler secret put NOTIFY_WEBHOOK` with a URL that accepts a JSON POST,
then enable the rules in Admin > Settings. Payloads carry the same template
fields as the Pi's Apprise setup (`comname`, `sciname`, `confidencepct`,
`listenurl`, `reason`, ...). An Apprise API server, Discord, Slack or a
small Worker all work. The Pi's own Apprise notifications are unaffected.

## Flickr photos (optional)

`wrangler secret put FLICKR_API_KEY`, then choose Flickr as the photo source.

## Local development

```
cd cloud/worker
cp .dev.vars.example .dev.vars        # edit the tokens
npm run db:schema:local
npm run db:seed:local                 # a handful of fake detections
npm run dev                           # http://localhost:8787
```

`npm run typecheck` runs `wrangler types` and `tsc`.

## Updating

```
cd cloud/worker && git pull && npm install && npm run db:schema:remote && npm run deploy
```

The schema file is idempotent; re-running it never drops data. On the Pi,
run `git -C ~/birdnet-cloud pull`, then re-run `install.sh` with the same
arguments to pick up a new agent. On a database created before a migration
in `db/migrations/` was added, run that migration before deploying.
