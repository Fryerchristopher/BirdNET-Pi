# Field Journal front end

The "Field Journal" design for BirdNET-Pi Cloud: a living field guide to one
place. One plate per species with a photo, its best recording as a playable
spectrogram and a twelve-month "heard here" strip; a this-week home page; a
species page with when-it-sings and heard-here charts; Today with the
who-sang-when dot grid; Listen live; a calendar archive.

The design handoff that this implements is in `../docs/field-journal/`
(DESIGN.md is the source of truth for tokens, copy and behavior).

## Serving it

In `worker/wrangler.toml`, point `[assets] directory` at `../web-field-journal`
(the default) and deploy. The Worker serves `index.html` for the client-side
routes (`/species/:slug`, `/day/:date`, `/archive/:yyyy-mm`), so no extra
configuration is needed.

Copy for the site lives in settings, not in the code (Admin > Settings):
`site_name` (the wordmark), `site_tagline` (home subtitle), `footer_blurb`,
`weather_url` and `weather_label` (the link next to conditions),
`weather_api_url` (a Dorrington Weather style API that fills in temperature,
wind and rain), `stream_url` (enables Listen live).

## Layout

```
index.html          the app shell; the Worker serves it for every page route
fj/style.css        tokens (light and dark) and components, from the handoff
fj/app.js           router, header, footer, API client, spectrogram recolor, audio, photos, recording dialog
fj/pages/*.js       one module per screen: home, species, search, today, live, archive
admin/, js/, css/   the admin pages, shared verbatim with ../web
img/                favicon
```

No build step. Fonts (Newsreader, Figtree) come from Google Fonts.

## How the pieces map to the API

| Screen | Endpoint |
|---|---|
| Header search, species A to Z | `/api/v1/journal/species` |
| This week | `/api/v1/journal/home` |
| Species page | `/api/v1/journal/species/:slug`, photos from `/api/v1/journal/photos/:sci` |
| Today, past day | `/api/v1/journal/day/:date`, clips from `/api/v1/journal/clips` |
| Recording detail | `/api/v1/journal/recording/:file_name` (conditions at that moment) |
| Listen live | `/api/v1/journal/live` |
| Archive | `/api/v1/journal/archive/:yyyy-mm`, `/api/v1/journal/archive/day/:date` |

Spectrograms are the Pi's sox PNGs, cropped past the axes and recolored on a
canvas into the handoff's colormaps (page and conifer variants, light and
dark). Audio is the Pi's clip; the playhead follows the real duration.

## Dark mode

Follows `prefers-color-scheme`. The footer's Dark mode / Light mode toggle
overrides it per device (`localStorage` key `fj-theme`).
