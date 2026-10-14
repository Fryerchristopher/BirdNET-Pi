# Theming and custom designs

Two front ends ship with the repo. `[assets] directory` in
`worker/wrangler.toml` chooses which one the Worker serves:

| Directory | What it is |
|---|---|
| `web-field-journal/` | The Field Journal design (default). Its tokens, copy and behavior are specified in `docs/field-journal/DESIGN.md`; light and dark are built in. Site copy comes from settings. |
| `web/` | The classic UI, a page-for-page port of BirdNET-Pi, themable with CSS variables as described below. |

Both talk only to `/api/v1` and share the admin pages.

For the classic UI there are three levels, from least to most work.

## 1. Pick a bundled theme

Admin > Settings > Theme. Bundled: `default` (the classic BirdNET-Pi greens)
and `forest-night` (dark). Any page previews a theme with `?theme=<name>`.

## 2. Write a theme

A theme is one CSS file at `web/css/themes/<name>.css` that defines the
custom properties below on `:root`. `web/css/base.css` does all the layout
and reads only these variables, so a theme that sets them all is complete.
Copy `default.css`, change the values, commit, deploy, pick it in settings.

| Variable | Used for |
|---|---|
| `--font` | font stack |
| `--bg` | page background |
| `--surface`, `--surface-2` | cards; list rows, code blocks, inactive chips |
| `--header-bg`, `--nav-bg` | header bar, nav bar |
| `--nav-text`, `--nav-hover`, `--nav-active`, `--nav-active-text` | nav links |
| `--text`, `--text-muted`, `--heading` | body text, secondary text, headings |
| `--link`, `--link-hover` | links |
| `--accent`, `--accent-hover`, `--accent-contrast`, `--accent-dim` | primary buttons, active sort chips, bars in charts, text on accent, translucent accent fills |
| `--success`, `--danger`, `--warning` | online dot and positive change; offline dot, delete, negative change; warnings |
| `--border` | all borders and chart grid lines |
| `--control-bg`, `--button-bg`, `--button-text`, `--button-hover` | inputs and ordinary buttons |
| `--radius`, `--radius-sm`, `--radius-pill` | corner radii |
| `--shadow`, `--shadow-lg` | card and popup shadows |
| `--transition` | hover transitions |

A theme may also override any selector from `base.css` after the variables;
`forest-night.css` dims images that way. Dark-mode-aware themes can
redefine the variables under `@media (prefers-color-scheme: dark)`.

Chart.js charts read `--accent`, `--accent-dim`, `--text-muted` and
`--border` at draw time, so they follow the theme too.

## 3. Ship your own front end

Replace the `web/` directory (or point `[assets] directory` in
`wrangler.toml` somewhere else). Build against `docs/API.md`; anything the
default UI does, it does through those endpoints, so a React, Svelte, Astro
or hand-written site has the same capabilities. Keep these paths free for
the Worker: `/api/*`, `/ingest/*`, `/media/*`, `/theme.css`, `/stream`,
`/index.php`, `/views.php` (the last two are redirects for links from the
Pi era, for example in old notifications).

If your front end has its own admin, call `/api/v1/admin/*` with the bearer
token or behind Cloudflare Access, exactly as the default admin page does.

## Where the default UI's pieces live

```
web/
  index.html, today.html, ...   one static shell per page (identical except the title and script)
  admin/index.html
  js/app.js                      shared runtime: API client, shell, detection card, player, mini graph, dialogs, Ask panel
  js/<page>.js                   one module per page
  css/base.css                   layout and components, variable-driven
  css/themes/*.css               themes
  img/bird.svg                   logo and favicon
```

Pages render client-side from the API. To change what a page shows, edit
its module; to change how everything looks, edit `base.css` or a theme.
