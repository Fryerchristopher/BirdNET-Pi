# Handoff: Dorrington Birds, "Field Journal" front end

## Overview

Dorrington Birds (birds.dorringtonbirds.com) is the public face of a private BirdNET-Pi listening station in Dorrington, in the Sierra Nevada (4,767 ft). A Raspberry Pi with a microphone records around the clock. BirdNET identifies birds in 3-second windows and saves a clip and spectrogram for each detection. The data and web layer are moving to Cloudflare, with the Pi acting only as a collector.

This package defines the chosen direction, **Field Journal**: a living field guide to one place. Every species gets a field-guide "plate" with a photo, its best recording as a playable spectrogram, and a 12-month "heard here" strip. Audience: family, guests, and curious birders, most of them on phones.

**Privacy rule:** never name the property. Use "the station" (for example "This week at the station") and "Dorrington" for the town. The reference docs in `/reference` predate this rule and still say "the Dome". The designs are correct; follow them.

## About the design files

The files in `/design` are **design references built in HTML**: prototypes that show the intended look, copy, and behavior. They are not production code. Recreate them on the Cloudflare build using whatever stack you choose (for example Workers + Pages with a light framework, Astro, or SvelteKit). Match the design exactly; implement it idiomatically.

- `design/B Field Journal.dc.html` is the full desktop and mobile design, with every screen. Open it in a browser alongside `support.js` and `spectro.js`. Navigate with the header. Add `#home`, `#species`, `#today`, `#search`, `#live` or `#archive` to the URL to open a screen directly.
- `design/B Field Journal Mobile.dc.html` shows five screens in 390 px phone frames, as embedded iframes of the file above.
- `design/spectro.js` draws **mock** spectrograms on `<canvas>` for the prototype only. In production, use real spectrogram PNGs from the station, or render real FFT data with the same colormaps (see Tokens).
- `design/support.js` is the prototype runtime. Ignore it.
- `reference/` holds the original brief and the site audit (background and rationale).

All counts, dates, weather values, week figures, monthly patterns and photos in the prototype are **sample data** unless noted. Anything marked "(sample)" in the UI must come from the API. Remove the "(sample)" labels in production.

## Fidelity

**High fidelity.** Colors, type, spacing, copy and interactions are final. Photos are striped placeholders; production uses real photography with credits (see Assets).

## Global rules

- Sentence case everywhere. No all-caps labels, no tracked-out eyebrows, no numbered section labels.
- No em dashes in copy.
- No shadows. Separate things with 1 px `--rule` hairlines and space.
- Never put tags or labels on top of photos. The only overlay allowed is the "Best recording" button on the species photo.
- Yellow (`--accent`) appears only on interactive or "now" elements: play buttons, the current month, the current hour, the focus ring, the selected archive day. Never use yellow as a text color on light backgrounds. Text on yellow is always `#1E2A24`.
- Serif (Newsreader) is for names and reading text. Never use it for data. Numbers use Figtree with tabular figures.
- Credit every photo.
- Never show raw file paths or native `<audio controls>`.

## Design tokens

### Color

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | #F1F2EE | #121A15 | Page (granite) |
| `--surface` | #FAFBF8 | #1A231D | Plates, panels, inputs |
| `--ink` | #1E2A24 | #E9ECE6 | Text |
| `--muted` | #5D6A62 | #A3AEA6 | Captions, scientific names, credits, secondary text |
| `--conifer` | #23402F | #8FB59B | Header band, structure, chart bars, heard-here fills |
| `--onconifer` | #FAFBF8 | #121A15 | Text on the conifer band |
| `--accent` | #E3B422 | #E8BE3A | Tanager yellow. Action and "now" only |
| `--lake` | #2D5B88 | #8DB4DA | Secondary color: section labels, "new this week", sun times, "Today so far" tile, links to search |
| `--onlake` | #FAFBF8 | #121A15 | Text on the lake tile |
| `--rule` | #D5D9D2 | #2C3830 | Hairlines and borders |
| `--nighttint` | #E7EBE5 | #151E18 | Night columns in the dot grid |

Overlay scrim for the recording detail view: `rgba(18,26,21,0.62)`.

Heard-here ramp, levels 0 to 4 (absent to strongest):
- Light: `#FAFBF8, #CFDCCF, #9DBAA6, #5F8A6E, #23402F`
- Dark: `#1A231D, #2F4A3A, #4F7A5E, #8FB59B, #CFE6D4` (the strongest level is the brightest)

Spectrogram colormaps (interpolate linearly from quiet to loud):
- On the page, light: `#FAFBF8, #CFDCCF, #9DBAA6, #5F8A6E, #23402F, #0F2418`
- On the page, dark: `#121A15, #1F3328, #5F8A6E, #9DBAA6, #DCEBDD`
- On conifer panels (hero, detail view, missing-photo plate): `#23402F, #2F5540, #5F8A6E, #9DBAA6, #DCEBDD`

Dark mode is supported. Light is the default. The prototype exposes it as a tweak. Production follows `prefers-color-scheme`, with an optional manual toggle remembered per device.

### Type

- **Newsreader** (Google Fonts; `ital, opsz 6..72, wght 400..700`): species names, page titles, headings, reading text. Weight 500. Big titles use `font-variation-settings: 'opsz' 72`. Italic for scientific names.
- **Figtree** (Google Fonts; `wght 400..700`): navigation, buttons, numbers, labels, captions. `font-variant-numeric: tabular-nums` on every count and time.
- Base: 15 px Figtree, line-height 1.5.
- Scale (px): 11, 12, 13, 14, 15, 17, 18, 19, 20, 22, 24, 26, 30, 42, 60.
  - Hero species name and species page h1: `clamp(40px, 10vw, 60px)`, line-height 1, letter-spacing -0.02em.
  - Page h1: `clamp(32px, 7vw, 42px)`, line-height 1.1.
  - Section h2: 30 px. Panel h2: 20 to 22 px.
  - Reading text: 18 px Newsreader, line-height 1.6, max 68ch.
  - Credits: 12 to 13 px Figtree italic in `--muted`.
- Placeholder-only mono (the prototype's photo explainers): ui-monospace 11 to 12 px. Not used in production.

### Shape and space

- Radius: **2 px** on plates, panels, photos and cards (like printed plates). **Fully round** (999px / 50%) on buttons, chips, the search field and the play buttons. No other radii.
- Spacing scale: 4, 8, 12, 16, 24, 40, 64, 96. Sections on Home are 64 px apart. Page side padding is `clamp(16px, 5vw, 40px)`. Max content width is 1240 px.
- Panel accent: some panels get a 3 px top border in `--lake` or `--conifer` (noted per component). Never a left-border accent.

### Motion

Nothing moves on its own. During playback the play button becomes Pause and a 2 px `--accent` playhead crosses the spectrogram from left to right over the clip length (3 s). Respect `prefers-reduced-motion` (no playhead animation; show the elapsed time instead).

## Information architecture

Header navigation (five items): **This week** (`home`), **Species** (`search`; also highlighted on species pages), **Today**, **Listen live**, **Archive**. Admin is a footer link behind Cloudflare Access. The footer also links to Dorrington Weather (weather.dorringtonbirds.com) and to the BirdNET-Pi repository (https://github.com/Nachtzuster/BirdNET-Pi).

Suggested routes: `/`, `/species`, `/species/:slug`, `/today`, `/day/:date`, `/live`, `/archive/:yyyy-mm`, `/admin/*`.

## Screens

### Header (all screens)

- **Desktop (≥760 px):** conifer band, padding 18 px vertical. Contents left to right:
  - Wordmark "Dorrington Birds": Newsreader 28 px, weight 500, `--onconifer`, links home.
  - The nav: Figtree 15 px, weight 500, gaps of 28 px. Inactive items at 80% opacity. The active item at 100% with a 2 px `--accent` underline (inset box-shadow).
  - Search field at the right: pill, `--surface`, 9 px × 16 px padding, flex basis 300 px, minimum 220 px. Placeholder "Find a bird heard at the station".
- **Type-ahead:** matches common or scientific names, case-insensitive substring, up to 6 results. It shows a dropdown: `--surface`, 1 px rule border, 2 px radius. Each row has the common name (Newsreader 17) and the scientific name (italic, muted). Selecting a row opens that species page.
- **Mobile (<760 px):** wordmark Newsreader 24 px, then two controls.
  - A 44 px round search button (magnifier icon) that opens the full-width search field under the bar.
  - A pill Menu button, 44 px tall, that toggles a vertical list of the five nav items. Each item is 52 px tall with a hairline between items; the current item is weight 700. The button label switches to "Close".
  - Opening one panel closes the other. Choosing an item closes the menu.
- **Collector offline banner:** a thin bar under the header on `--surface`: "The microphone has not reported since 06:12. Showing the last data received." Fill in the real time.

### 1. This week (Home)

1. **Intro.**
   - h1 "This week at the station".
   - Subtitle (18 px Newsreader, muted): "Birds heard from a listening station at 4,767 ft in the Sierra Nevada."
2. **Hero:** a two-column grid, `repeat(auto-fit, minmax(min(100%, 440px), 1fr))`, gap 40.
   - **Left column** (content aligned to the bottom):
     - "Most heard this week" (Figtree 600, `--lake`).
     - The species name as a link (60 px Newsreader).
     - The scientific name (22 px italic, muted).
     - A presence line plus "Heard 85 times today." (18 px Newsreader). The presence line is computed; see State.
     - A **conifer panel** (padding 16): the best clip's spectrogram, 120 px tall, in the conifer colormap. Below it, the yellow pill button "Hear it" with a play triangle, and "Today 08:47, 90% confidence" (14 px, `--onconifer`).
   - **Right column: a square (`aspect-ratio: 1/1`) 2×2 grid**, gap 16.
     - **Cells 1 to 3 are photos:** "Most heard" (top species this week), "Runner-up" (second), and "Rarest this week" (the species with the lowest non-zero count this week).
       - Each has a heading line above the photo: the label in `--lake` 600 14 px, then the name in Newsreader 17, then "N this week" muted.
       - Each has a credit line below the photo.
       - The photo fills the remaining height (object-fit: cover) and is clickable to the species page.
     - **Cell 4 is the "Today so far" tile:** `--lake` background, `--onlake` text, padding 20.
       - Headline: "Today so far: 168 detections of 10 species." (Newsreader 22).
       - A hairline, then the conditions: "52°F, calm, no rain" (bold) and "Sunrise 07:12, sunset 18:29".
       - A hairline, then the comparison: "**Busier than yesterday**, 168 vs 131 by 09:15" and "**About usual** for mid-October".
       - Footer row: a "Today" link (underlined, `--onlake`).
     - **Mobile:** rows of `200px 200px auto`. Row 1 holds the two top photos. "Rarest" spans both columns in row 2. The tile spans both columns in row 3. There is no square constraint.
3. **This week's birds** (plate grid).
   - Header row: h2 30 px, with a muted note on the right, "13 species, Oct 8 to 14."
   - Grid: `repeat(auto-fill, minmax(min(100%, 240px), 1fr))`, `grid-auto-flow: dense`, gap 24.
   - There is exactly one plate per species heard this week, ordered by this week's count.
   - The top species' plate spans 2×2 on desktop; on mobile all plates are equal. An optional "Uniform" setting makes every plate the same size.
4. **New this week / Quiet this week.** Two columns (`minmax(min(100%, 380px), 1fr)`, gap 40).
   - **New this week:** a 2 px `--lake` top rule, h2 in `--lake`, and the subtitle "Heard this week but not last week." Each row has the species name (Newsreader 22, `--lake`, links to its page) and a muted note on the right such as "First heard Oct 9".
   - **Quiet this week:** a 2 px `--conifer` rule and the subtitle "Heard last week, not since." Each row says "Last heard Oct 6". These rows are not links.
5. **Today strip.** A surface panel: "Today so far: 168 detections of 10 species. The first was at 06:28, the latest at 08:47." plus a conditions sentence, and a "Today" outline pill button.

### Plate (component)

- **Card:** `--surface`, 1 px rule, 2 px radius, overflow hidden.
- **Photo:** 4:3, clickable. If there is no photo, show the **missing-photo variant**: a conifer block with the species' spectrogram inset at 72% in the conifer colormap. Never a generic bird icon.
- **Body (padding 16/18/18, gap 12):**
  - Name: Newsreader 22, or 30 on the big plate. Underline on hover; links to the species page.
  - Scientific name: italic, 16 px, muted.
  - A row with a 36 px yellow round play button and a 36 px tall spectrogram strip (with the playhead).
  - The **heard-here strip**: 12 equal cells, 12 px tall, gap 2, filled from the ramp, with the current month marked by a 4 px `--accent` inset bottom bar. Single-letter month labels underneath (J F M A M J J A S O N D, 11 px muted).
  - A footer row: "85 today, 512 this week" on the left (or only "N this week") and the presence line, muted, on the right.

### 2. Species page (`/species/:slug`)

1. **Header.**
   - Breadcrumb button "This week at the station" (muted 14).
   - h1: the name, `clamp(40px,10vw,60px)`.
   - The scientific name: italic 22 px, muted.
2. **Main row** (flex, wraps, gap 40).
   - **Left column** (flex 2, basis 520 px; a flex column):
     - A 3:2 main photo with a yellow pill "Best recording" button overlaid at the bottom left (20 px inset). It plays the best clip.
     - A credit line.
     - A **gallery of 3 photos** in a 3-column grid, gap 12, with the captions "In flight", "Foraging" and "Perched", each with a credit line. The gallery stretches to fill the column down to the bottom of the right column.
   - **Right aside** (flex 1, basis 280 px):
     - h2 "Heard at the station" in `--lake`.
     - Four fact rows with hairlines between them: First heard, Last heard, Total, Usual time.
     - A reading line: the presence line, plus "Usually heard between HH:00 and HH:00."
     - The **More birds this week** box: `--surface`, 3 px `--lake` top border, padding 16/18.
       - The title "More birds this week" in `--lake`.
       - A 40 px round magnifier button that opens Search.
       - Rows for the next 9 species by this week's count, leaving out the current one: the name in Newsreader 17 and "N this week" muted 13. Each row opens that species page.
       - Below the rows, the link "All birds heard at the station", which opens Search.
3. **Heard here through the year.**
   - 12 cells, 64 px tall, gap 4, with full month names underneath. The current month gets a bold label and the yellow bottom bar.
   - Note: "Detections by month, averaged across years."
4. **When it sings.**
   - A 24-bar chart, 160 px tall, gap 4, in `--conifer`, with a 1 px ink baseline.
   - Sunrise and sunset are drawn as 2 px `--lake` vertical lines with 12 px labels, placed by the real times.
   - X labels: Midnight, 6 am, Noon, 6 pm, Midnight.
5. **Recordings from the station.**
   - The 6 best clips by confidence, in a grid of `minmax(min(100%, 300px), 1fr)`, gap 24.
   - Each card has a 96 px spectrogram, a 40 px yellow play button, the date and time (bold), the confidence (muted 13), and a "Details" label in `--lake`.
   - The card's play button only plays. Clicking anywhere else on the card opens the **recording detail view**.
   - A "Show all recordings" link sits in the section header.
6. **Learn more:** links to All About Birds, Wikipedia, and eBird.

**Recording detail view** (a dialog with `aria-modal`):
- **Overlay:** the scrim, padding `clamp(8px,3vw,24px)`.
- **Panel:** max-width 1040, `--surface`, 3 px `--lake` top border.
- **Top bar:**
  - The name and the scientific name.
  - "2 of 6", then previous and next round buttons (40 px) and a Close pill.
- **Body:** a 2-column grid that stacks on mobile.
  - Left: a 4:5 photo with a credit line.
  - Right:
    - The spectrogram (220 px tall, on a conifer panel, conifer colormap) with a 0 to 3 s axis.
    - The yellow "Play" pill and a "Download clip" link.
    - Fact rows: Heard (date and time), Confidence, Conditions (temperature, wind and rain at that moment, from the weather station), Length.
- **Keyboard:** Esc closes; the left and right arrow keys move between recordings. Clicking the scrim closes. Return focus to the card on close.

### 3. Species search (`/species`)

- **h1** "Find a bird heard at the station".
- **Subtitle:** "N of 130 species shown here, A to Z."
- **Search field:** a large pill with a magnifier, `--surface`, max-width 640 px, 18 px text. It filters as you type and shows results in a grid of name plus scientific name, with the count line "N birds match".
- **Letter index:** a row of round 36 px letter buttons in `--lake`, only for letters that have species. Each scrolls to its section.
- **A to Z sections:** a large letter (Newsreader 42, `--lake`) in a left column `clamp(36px,8vw,64px)` wide, and a grid of species buttons on the right: the name (Newsreader 19) and "N this week" when heard this week. Every species ever detected is listed and clickable.

### 4. Today (`/today`; the same layout serves `/day/:date`)

1. **h1** "Today", then the reading line: "168 detections of 10 species so far today. The first was at 06:28."
2. **Conditions at the station** panel (3 px `--lake` top). A grid of five figures, value 26 px 600 with a muted 14 px label: Temperature, Wind, Rain today, Sunrise, Sunset. There's a "Dorrington Weather" link at the top right. The data comes from the weather station API.
3. **Compared with other days** panel (3 px `--lake` top).
   - "Busier than yesterday", with "168 vs 131 by 09:15".
   - "About usual for mid-October", with "Typical 150 to 190 by 09:15".
   - **Comparison logic:** compare against yesterday up to the same time of day, and against a typical range for this date (for example the 25th to 75th percentile of the same weeks in past years, up to the same time).
   - **Wording:** "Busier than", "Quieter than" or "About the same as" yesterday; "About usual", "Busier than usual" or "Quieter than usual".
4. **Who sang when** (dot grid; 3 px `--conifer` top border).
   - **Header:** h2 30 px. The legend shows three dot sizes with the text "Dot size is calls in that hour", a night swatch, and a lake line labelled "Sunrise 07:12, sunset 18:29".
   - **Hint line** above the grid: "Hover a dot for the count. Click it to hear those calls." It changes on hover to, for example, "Golden-crowned Kinglet, 07:00 to 08:00, 12 calls".
   - **Grid columns:** `200px repeat(24, minmax(30px,1fr)) 150px` on desktop (min-width 1100 px); `130px … 90px` on mobile (min-width 960 px). It scrolls horizontally, and the name column is `position: sticky; left: 0`.
   - **Header row:** hours 00 to 23. The current hour is a yellow pill with ink text, weight 700.
   - **Rows:** one per species heard today, sorted by today's count. Each row is 44 px tall, with a hairline above it.
   - **Cells:**
     - A dot whose diameter is `7 + 20 × sqrt(n / maxCellCount)` px, in `--conifer`.
     - Past hours with zero calls show a 3 px `--rule` dot, meaning the station was listening. Future hours are empty.
     - Night hours (before sunrise hour, after sunset hour) have a `--nighttint` background.
   - **Sun lines:** sunrise and sunset are 2 px `--lake` lines at 70% opacity, placed at the exact fraction of the day across the 24 hour columns.
   - **Row end:** an 8 px conifer bar sized relative to the day's top species, and the total (bold 14).
   - **Click a dot** to select it. The selected dot gets a yellow ring (3 px surface gap, then a 2 px accent ring). A panel opens under the grid with the title "Species, HH:00 to HH:00, N calls" and up to 12 clip cards (play, spectrogram, time, confidence), plus a Close button.
   - **Mobile:** this card is first, directly under the reading line, followed by Conditions and Compared. On desktop, Conditions and Compared come first. On load, auto-scroll the grid horizontally so the first active hours (about 05:00) are in view.
5. **Hour by hour.** h2, then one row per hour (newest first) on a grid of `clamp(64px,14vw,96px) 1fr`.
   - Each row has the hour label (Newsreader 22) and species chips: a `--surface` pill with the name and a bold count in `--lake`.
   - Tapping a chip expands that species' clips for that hour (as in the original brief).

### 5. Listen live (`/live`)

- Centered: h1, then the subtitle "The station microphone, as it hears the forest right now."
- A 132 px round yellow button: a play triangle when stopped, a square when playing. The label under it reads "Start listening" or "Stop listening", with a muted note.
- **Live spectrogram panel:** `--surface`, 300 px tall, page colormap, scrolling right to left. A kHz axis (10, 5, 0) on the left and a time axis from "12 seconds ago" to "Now".
- **Heard in the last 15 minutes:** the h2, "Updated HH:MM", and mini plates (a 64 px photo, the name, "Last heard HH:MM"). Each opens its species page.
  - **Empty state:** "Nothing identified since 08:47. Birds often go quiet by mid-morning. These were the last ones heard:" followed by the last four distinct species.

### 6. Archive (`/archive/:yyyy-mm`)

- **Header:** h1 "Archive", previous and next round buttons around the month title (Newsreader 24). The next button is disabled at the current month.
- **Intro:** "Each day shows how many species were heard. Darker days had more."
- **Calendar:** 7 columns, Sunday first. Each day is a square button with the day number (13) and the species count (`clamp(14px,3.6vw,20px)`, 600), filled from the heard-here ramp by count.
  - On dark fills, use light text.
  - Today has a 2 px inset accent ring; the selected day has a 3 px accent ring.
  - Future days are outlined only and disabled.
  - Below the grid: a "Fewer species … More" ramp legend.
- **Side panel** (3 px `--lake` top): with no day selected, "Choose a day". With a day selected, it shows the long date, the summary (species, detections), the top 5 species with counts, and an "Open today" or "Open this day" button that goes to `/day/:date`.

### Admin (`/admin`, behind Cloudflare Access)

Plain Figtree pages on `--surface`, with no photography: collector status (last upload, disk, uptime), settings, include and exclude species lists, log viewer, backup and restore. Destructive actions use a confirmation that names the action and requires typing it.

## States

- **Empty (no birds yet today):** "No birds heard yet today. Sunrise at the station is at 07:12." Use the real time.
- **Loading:** skeletons shaped like plates and panels. Never a blank panel.
- **Offline collector:** the banner described in the Header section; keep showing the last data.
- **Missing photo:** the conifer and spectrogram plate variant.
- **Playback:** only one clip plays at a time. Starting another stops the current one.

## State and logic

- **Presence line,** computed from the monthly levels (0 to 4) for the species:
  - every month above zero: "Here all year";
  - otherwise find the longest run of present months, wrapping across December to January: "Here October to April".
- **Usual time:** the peak hour plus or minus one or two hours from the all-time hourly distribution, as "Usually heard between 07:00 and 10:00".
- **Rarest this week:** the minimum non-zero count this week.
- **Heard-here level for each month:** quantize the average detections per month across years into 5 levels, scaled per species.
- **Sun times:** compute sunrise and sunset for Dorrington daily (with civil twilight if needed) on the server.
- **Breakpoint:** 760 px. Below it: the compact header, the mosaic in its mobile arrangement, plates all the same size, Who sang when first on Today, and the narrow dot-grid columns.

## Data the front end needs (Cloudflare API)

- **Per detection:** id, timestamp, species slug, common name, scientific name, confidence, clip URL (3 s), spectrogram URL (or FFT data).
- **Per species:**
  - totals, first and last heard;
  - counts by month (averaged across years) and by hour (all time);
  - the top 6 clips by confidence;
  - this week's and last week's counts;
  - photos: one main photo plus up to 3 gallery photos, each with url, width, height, photographer, license, and source page URL.
- **Per day:** detection count, species count, first detection time, sunrise and sunset, plus the counts by hour and species used by the dot grid. For comparisons: yesterday's count up to the same time and a typical range for the date.
- **Weather (from weather.dorringtonbirds.com):** current temperature, wind and rain, and readings at any detection timestamp.
- **Station:** last upload time from the collector.
- **Live:** the audio stream URL, a spectrogram feed, and new detections (SSE or polling).

## Assets

- **Fonts:** Newsreader and Figtree from Google Fonts. Self-host them on Cloudflare if you prefer.
- **Photos:** BirdNET-Pi already fetches species photos from Flickr (Tools > Settings > Flickr API key), and the Nachtzuster version may also be able to use Wikipedia instead.
  - **Keep the key on the server:** fetch and cache images in a Worker or R2, never in the browser.
  - **Licenses:** limit results to Creative Commons.
  - **Credits:** store the photographer, license and photo page URL. Render the credit as "Photo: {name} on Flickr, {license}", linked to the photo page; Flickr's terms require that link.
  - **Gallery:** the 3-photo gallery needs the next results beyond the first.
  - **Cropping:** crop with `object-fit: cover` (centered).
  - **No photos of the property** ("At the station" photos were removed on purpose).
- **Icons:** the play triangle, pause bars, stop square, magnifier and arrows are all simple CSS or SVG shapes. Any simple 1.5 px stroke icon set (for example Phosphor) is fine.
- **Spectrograms:** use the station's real images. Recolor them to the colormaps above, or render them from FFT data.

## Files

- `design/B Field Journal.dc.html`: all screens, desktop and mobile (the source of truth).
- `design/B Field Journal Mobile.dc.html`: a 390 px phone preview of five screens.
- `design/spectro.js`: the mock spectrogram renderer (prototype only).
- `design/support.js`: the prototype runtime (ignore).
- `reference/B-field-journal-handoff.md`: the original direction brief.
- `reference/00-audit-and-directions.md`: the site audit, page inventory, and reference-site notes.
- `screenshots/`: desktop (rendered at 60% zoom, so about 1500 px of layout per image) and mobile (390 px) captures of every screen and key state. Photos are placeholders in every capture. Mobile screenshots show the dot grid scrolled to 00:00; the live design auto-scrolls it to about 05:00 on load.
