# Handoff B: Field Journal

Design handoff for Claude Design.  Redesign of birds.dorringtonbirds.com, a BirdNET-Pi listening station at the Dorrington Dome in the Sierra Nevada foothills.

## 1. Design read

Reading this as: a living field guide to one place, for family, guests and curious birders, with a naturalist's-notebook language, leaning toward an editorial layout with field-guide plates, real bird photography and sound.

- Impeccable mode: Read.  The visitor learns which birds live here and what they sound like.
- Taste dials: DESIGN_VARIANCE 6, MOTION_INTENSITY 3, VISUAL_DENSITY 4.
- Redesign mode: overhaul the visuals, keep every feature.  The species page becomes the center of the site.
- Serif justification: field guides and naturalist journals are a print tradition this site belongs to.  The serif is used for names and reading text, never for data.

## 2. What the product does

A microphone at the cabin records 24 hours a day.  BirdNET identifies birds and saves a short clip and spectrogram for each detection.  Over time the station has built a record of which birds are present, when they sing, and how that changes through the year.  That record is the story this direction tells.

Sample data (real, October 14, 2026 at 09:15):
- 130 species heard at the Dome all time, 10 so far today, 168 detections today.
- Today: Red-breasted Nuthatch 85, Golden-crowned Kinglet 31, Northern Flicker 14, Common Raven 11, Brown Creeper 11, Mountain Chickadee 4, Pileated Woodpecker 4, White-headed Woodpecker 3, Steller's Jay 3.
- Latest: Red-breasted Nuthatch (Sitta canadensis), 08:47:47, 90% confidence.

## 3. Concept

Every bird heard at the Dome gets a **plate**, like a page in a field guide.  A plate holds the bird's photo, common and scientific names, its best recording as a playable spectrogram, and a 12-month "heard here" strip that shows which months it is present at the Dome.  The home page is this week's plates.  The species page is a full plate, modeled on the All About Birds species page but built around what this microphone has heard.

Signature element: **the "heard here" strip.**  Twelve small cells, one per month, filled in conifer green by how many detections that month (averaged across years).  It appears on every plate at small size and on the species page at large size with month names.  It answers the question guests ask most: "Is this bird here all year?"

Photography carries the site, as it does on Audubon and All About Birds.  Spectrograms are the second image type and get the same respect as photos.

## 4. Tokens

### Color

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | #F1F2EE | #121A15 | Granite page |
| `--surface` | #FAFBF8 | #1A231D | Plates and panels |
| `--ink` | #1E2A24 | #E9ECE6 | Text |
| `--ink-muted` | #5D6A62 | #A3AEA6 | Captions, scientific names, credits |
| `--conifer` | #23402F | #8FB59B | Structure: header band, heard-here fills, rules |
| `--accent` | #E3B422 | #E8BE3A | Tanager yellow.  Play buttons, current-month marker, focus ring.  Text on yellow is `--ink` (#1E2A24). |
| `--rule` | #D5D9D2 | #2C3830 | Hairlines |

Heard-here ramp (absent to strongest): `--surface`, #CFDCCF, #9DBAA6, #5F8A6E, #23402F.  In dark mode reverse the lightness so the strongest month is the brightest.

Spectrogram colormap: from `--surface` through the heard-here ramp to #0F2418 (light), or from #121A15 to #DCEBDD (dark).

Rules: yellow is the only accent and appears only on interactive or "now" elements.  Never use yellow as a text color on light backgrounds.

### Type

- **Newsreader** (Google Fonts): species names, page titles, reading text.  Display at weight 500 to 600, optical size high.  Italic for scientific names.
- **Figtree** (Google Fonts): navigation, buttons, numbers, chart labels, captions.  Tabular figures for counts.
- Scale: 13, 15, 18, 22, 30, 42, 60 px.  Reading text 18 px Newsreader, line height 1.6, max 68 characters per line.
- Sentence case everywhere.  No all-caps labels.

### Shape, space, motion

- Plates: 2 px radius, like printed plates.  Chips and the play button: fully round.  That is the whole radius rule.
- Spacing scale: 4, 8, 12, 16, 24, 40, 64, 96.  Generous space between plates.
- Shadows: none.  A 1 px `--rule` border on plates.
- Motion: a play button turns into a pause button and a playhead crosses the spectrogram during playback.  Nothing moves on its own.  Respect reduced motion.

## 5. Navigation

A conifer-green header band with the wordmark "Dorrington Birds" set in Newsreader, and five items in Figtree: **This week, Species, Today, Listen live, Archive.**  Admin is a small link in the footer, gated by Cloudflare Access.  On phones, the header collapses to the wordmark, a search button, and a menu.

Search is first-class: "Find a bird heard at the Dome" with type-ahead on common and scientific names.

## 6. Screens

### Home ("This week at the Dome")

```
+--------------------------------------------------------------------+
| Dorrington Birds          This week  Species  Today  Listen live   |
+--------------------------------------------------------------------+
| [ full-width photo of the most-heard bird this week, 21:9 ]        |
| Red-breasted Nuthatch                        ( ▶ Hear it )         |
| Heard 85 times today.  (presence line)       photo credit, small   |
+--------------------------------------------------------------------+
| This week's birds                                       [ search ] |
| +----------------+ +---------+ +---------+                         |
| | large plate    | | plate   | | plate   |   plates sized by       |
| | (most heard)   | +---------+ +---------+   this week's count     |
| |                | +---------+ +---------+                         |
| +----------------+ | plate   | | plate   |                         |
|                    +---------+ +---------+                         |
+--------------------------------------------------------------------+
| New this week: species heard this week but not last week           |
| Quiet this week: species heard last week but not this week         |
+--------------------------------------------------------------------+
| Today so far: 168 detections, 10 species.  Latest 08:47.  ( Today ) |
+--------------------------------------------------------------------+
```

- The plate grid has exactly as many cells as species heard this week.  The top species gets a double-size plate.  Order by count.
- Hero subtext is at most 20 words.  One CTA: "Hear it."
- The presence line ("Here all year," "Here October to April") is computed from the monthly data, not written by hand.
- "New this week" and "Quiet this week" replace the Weekly Report and are the most story-like part of the page.

### Plate (component)

```
+---------------------------+
| [ photo 4:3 ]             |
| Mountain Chickadee        |
| Poecile gambeli           |
| [ spectrogram strip  ▶ ]  |
| J F M A M J J A S O N D   |
| [■][■][□][□][■][■]...     |  heard-here strip
| 4 today                   |
+---------------------------+
```

### Species page

Modeled on the All About Birds species page:

```
+--------------------------------------------------------------------+
| Red-breasted Nuthatch                                              |
| Sitta canadensis                                                   |
| [ large photo 3:2 ]                     | Heard at the Dome        |
|   ( ▶ Best recording ) on the photo     | First heard  (date)      |
|                                         | Last heard   (date)      |
|                                         | Total        (count)     |
|                                         | Usual time   (hour range)|
+--------------------------------------------------------------------+
| Heard here through the year (large strip, month names, this month) |
+--------------------------------------------------------------------+
| When it sings: 24-hour bar chart with sunrise and sunset marked    |
+--------------------------------------------------------------------+
| Recordings from the Dome: 6 best clips as spectrogram cards with ▶ |
+--------------------------------------------------------------------+
| Learn more: All About Birds  |  Wikipedia  |  eBird               |
+--------------------------------------------------------------------+
```

Fill the figures from the build's data; mark any mockup figure as sample.  Photo credits sit under the photo in `--ink-muted` italic Figtree 13 px, as Audubon does.

### Species index

Two views with a toggle: a plate grid (default) and a compact list.  Filters: "Here now" (heard in the last 7 days), "Here all year," "Seasonal," and text search.  Sort by name, most heard, or most recent.

### Today

A short reading line at the top: "168 detections of 10 species so far today.  The first was at (time)."  Fill in the real first-detection time.  Below, a timeline grouped by hour.  Each hour shows its species as small chips with counts; tapping a chip expands the clips for that species in that hour.

### Listen live

A calm page: one large round play button in yellow, the live spectrogram below it in the page colormap, and "Heard in the last 15 minutes" as plates in miniature.

### Archive

Calendar-style month grid.  Each day cell shows the species count, tinted with the heard-here ramp.  Selecting a day opens that day's Today view.

### Admin (after sign-in)

Plain Figtree pages on `--surface`: collector status, settings, include and exclude species lists, log, backup and restore.  No photography.  Destructive actions use typed confirmation.

## 7. Components

- **Plate**, **heard-here strip**, **spectrogram card with play**, **species chip with count**, **photo with credit line**, **search with type-ahead**.
- **Empty state.**  "No birds heard yet today.  Sunrise at the Dome is at (time)."  Fill in the real sunrise time.
- **Missing photo.**  A conifer-tinted plate with the species' spectrogram in place of the photo.  Never a generic bird icon.
- **Loading.**  Plate-shaped skeletons.
- **Collector offline.**  A thin bar under the header: "The microphone has not reported since 06:12.  Showing the last data received."

## 8. Copy

Warm and plain, like a note left for guests.  "Here all year," "Usually heard at dawn," "New this week."  Numbers stay exact.  Never cute.  Buttons: "Hear it," "Play," "Show all recordings."

## 9. Do and don't

Do: lead with photos and sound; give the species page the most care; credit every photo; keep yellow for action and "now."

Don't: use cream and terracotta (a common generated-site look); use a dark background with green accents (the current look); add all-caps eyebrows or numbered section labels; put tags on top of photos; use em dashes anywhere.

## 10. What to produce in Claude Design

1. Home ("This week at the Dome"), desktop and mobile, light mode.
2. Species page for Red-breasted Nuthatch, desktop and mobile.
3. Species index in plate view.
4. Today, mobile.
5. Component sheet: plate (with and without photo), heard-here strip at small and large sizes, spectrogram card states, empty, loading and offline states, dark-mode versions of the plate and species page header.

## 11. Prompt to paste into Claude Design

> Design a redesign of birds.dorringtonbirds.com, a 24-hour bird listening station at a cabin in the Sierra Nevada foothills.  Follow the attached handoff exactly: direction "Field Journal," Read mode, Newsreader for names and reading text, Figtree for interface and numbers, the granite, conifer and Tanager yellow tokens in section 4, 2 px plates and round controls, no shadows.  Every species gets a field-guide plate with a photo, its best recording as a playable spectrogram, and a 12-month "heard here" strip.  Use the real sample data in section 2.  Produce the screens in section 10, starting with the Home page on desktop.

## 12. Data the front end needs from the Cloudflare build

Per detection: timestamp, common name, scientific name, confidence, clip URL, spectrogram URL.  Per species: totals, first and last heard, counts by month (all years), counts by hour, top six clips by confidence, image URL with photographer credit and license.  Per week: species counts this week and last week.  Per day: sunrise and sunset for Dorrington, first detection time.  Station: last upload time.  Live: audio stream and spectrogram feed.

## 13. Sibling site: Dorrington Weather

weather.dorringtonbirds.com is a separate station dashboard on the same domain.

- Open the home page with the same plain voice the weather site uses: "Birds heard from a listening station at 4,767 ft in the Sierra Nevada."
- Add one conditions line to Today, sourced from the weather station: "52°F, calm, no rain."  Link it to the weather site.
- Footer link to Dorrington Weather, and a matching wordmark if the weather site is reskinned later.
- Do not copy its look: the plates here replace its tile grid, and its all-caps labels and multicolor numbers stay out.
