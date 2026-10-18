/**
 * /api/v1/journal/*  Page-shaped endpoints for the Field Journal front end.
 *
 * The generic /api/v1 routes stay the contract for any front end; these add
 * the derived values the Field Journal design needs (weekly counts, monthly
 * "heard here" levels, presence lines, comparisons, sun times, photos with
 * credits, weather) so the browser makes one request per screen.
 */
import { Hono } from 'hono';
import type { AppEnv } from '../env';
import * as q from '../lib/db';
import { getSpeciesImage, flickrGallery } from '../lib/images';
import { addDays, daysBetween, isValidDate, localDate, localTime } from '../lib/time';
import { sunTimes, tzOffsetMinutes } from '../lib/sun';
import { currentConditions, conditionsAt } from '../lib/weather';
import { speciesLinks } from './api';

const journal = new Hono<AppEnv>();

/**
 * Seconds to keep a response in the Cloudflare edge cache, 0 for never. The Pi
 * pushes about once a minute, so anything about today can be a minute old;
 * past days, months and recordings change only when something is deleted.
 */
export function edgeTtl(url: URL): number {
  const p = url.pathname.replace(/^\/api\/v1\/journal/, '');
  const ageDays = (d: string | null | undefined) => (!d || d === 'today' || !isValidDate(d) ? 0 : (Date.now() - Date.parse(d + 'T00:00:00Z')) / 86_400_000);
  const recent = (d: string | null | undefined) => ageDays(d) < 2;
  if (p === '/site') return 30;
  if (p === '/home' || p === '/species' || p.startsWith('/species/')) return 120;
  let m;
  if ((m = p.match(/^\/(?:archive\/)?day\/([^/]+)$/))) return recent(m[1]) ? 60 : 3600;
  if (p === '/clips') return recent(url.searchParams.get('date')) ? 60 : 3600;
  if ((m = p.match(/^\/archive\/(\d{4}-\d{2})$/))) return ageDays(`${m[1]}-28`) < 35 ? 300 : 3600;
  if (p.startsWith('/recording/') || p.startsWith('/photos/')) return 3600;
  return 0; // /live and anything new
}

journal.use('*', async (c, next) => {
  const s = c.req.query('station') ?? 'default';
  c.set('station', /^[A-Za-z0-9_-]{1,64}$/.test(s) ? s : 'default');
  const ttl = c.req.method === 'GET' ? edgeTtl(new URL(c.req.url)) : 0;
  // caches.default is per Cloudflare location and a no-op on *.workers.dev.
  const cache = ttl ? (caches as unknown as { default: Cache }).default : null;
  if (cache) {
    const hit = await cache.match(c.req.raw);
    if (hit) {
      const res = new Response(hit.body, hit);
      res.headers.set('cache-control', hit.headers.get('x-client-cache-control') || 'no-store');
      res.headers.delete('x-client-cache-control');
      res.headers.set('x-edge-cache', 'hit');
      return res;
    }
  }
  c.header('cache-control', 'no-store');
  await next();
  if (cache && c.res.status === 200) {
    const stored = new Response(c.res.clone().body, c.res);
    stored.headers.set('x-client-cache-control', c.res.headers.get('cache-control') || 'no-store');
    stored.headers.set('cache-control', `public, max-age=${ttl}`);
    c.executionCtx.waitUntil(cache.put(c.req.raw, stored));
    c.res.headers.set('x-edge-cache', 'miss');
  }
});

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const p2 = (n: number) => String(n).padStart(2, '0');
export const slugOf = (sci: string) => sci.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

interface Ctx { station: string; tz: string; settings: Record<string, string>; today: string; now: string; st: Awaited<ReturnType<typeof q.stationInfo>>; }
async function ctx(c: { env: AppEnv['Bindings']; get: (k: 'station') => string }): Promise<Ctx> {
  const station = c.get('station');
  const [st, settings] = await Promise.all([q.stationInfo(c.env.DB, station), q.getSettings(c.env.DB)]);
  const tz = st?.timezone || 'UTC';
  return { station, tz, settings, today: localDate(tz), now: localTime(tz), st };
}

// ---- derived values ---------------------------------------------------------

/** "Here all year" or "Here October to April" from 12 monthly levels. */
export function presenceLine(levels: number[]): string {
  if (levels.every((v) => v > 0)) return 'Here all year';
  if (levels.every((v) => v === 0)) return 'Not heard yet this year';
  let best: [number, number] = [0, 0];
  for (let s = 0; s < 12; s++) {
    if (!levels[s] || levels[(s + 11) % 12]) continue;
    let l = 0;
    while (l < 12 && levels[(s + l) % 12]) l++;
    if (l > best[1]) best = [s, l];
  }
  if (best[1] === 1) return `Here in ${MONTHS[best[0]]}`;
  return `Here ${MONTHS[best[0]]} to ${MONTHS[(best[0] + best[1] - 1) % 12]}`;
}

/**
 * Monthly levels 0..4 for a set of species: average detections per calendar
 * month across the years the station was active in that month, quantized
 * per species against its own maximum.
 */
async function monthLevels(db: D1Database, station: string, scis: string[]): Promise<Map<string, { levels: number[]; avg: number[] }>> {
  const out = new Map<string, { levels: number[]; avg: number[] }>();
  if (!scis.length) return out;
  const active = await db.prepare("SELECT DISTINCT substr(date,1,7) AS ym FROM hourly_counts WHERE station_id = ?").bind(station).all<{ ym: string }>();
  const yearsPerMonth = new Array(12).fill(0);
  for (const r of active.results) yearsPerMonth[Number(r.ym.slice(5, 7)) - 1]++;
  const sums = new Map<string, number[]>();
  for (let i = 0; i < scis.length; i += 90) {
    const chunk = scis.slice(i, i + 90);
    const { results } = await db
      .prepare(`SELECT sci_name, CAST(substr(date,6,2) AS INTEGER) AS m, SUM(n) AS n FROM hourly_counts WHERE station_id = ? AND sci_name IN (${chunk.map(() => '?').join(',')}) GROUP BY sci_name, m`)
      .bind(station, ...chunk)
      .all<{ sci_name: string; m: number; n: number }>();
    for (const r of results) {
      const a = sums.get(r.sci_name) ?? new Array(12).fill(0);
      a[r.m - 1] += r.n;
      sums.set(r.sci_name, a);
    }
  }
  for (const sci of scis) {
    const s = sums.get(sci) ?? new Array(12).fill(0);
    const avg = s.map((v, i) => (yearsPerMonth[i] ? v / yearsPerMonth[i] : 0));
    const max = Math.max(...avg, 0);
    const levels = avg.map((v) => (v <= 0 ? 0 : Math.max(1, Math.min(4, Math.ceil((4 * v) / max)))));
    out.set(sci, { levels, avg });
  }
  return out;
}

function usualTime(hours: number[]): { peak: number; from: number; to: number; text: string } {
  const peak = hours.indexOf(Math.max(...hours));
  const from = Math.max(0, peak - 1);
  const to = Math.min(24, peak + 2);
  return { peak, from, to, text: `Usually heard between ${p2(from)}:00 and ${p2(to)}:00` };
}

async function hoursAllTime(db: D1Database, station: string, sci: string): Promise<number[]> {
  const { results } = await db.prepare('SELECT hour AS h, SUM(n) AS n FROM hourly_counts WHERE station_id = ? AND sci_name = ? GROUP BY hour').bind(station, sci).all<{ h: number; n: number }>();
  const a = new Array(24).fill(0);
  for (const r of results) a[r.h] = r.n;
  return a;
}

/** Counts per species in a date range, keyed by sci. */
async function countsIn(db: D1Database, station: string, from: string, to: string) {
  const { results } = await db
    .prepare('SELECT sci_name, MAX(com_name) AS com_name, SUM(n) AS n, MIN(date) AS first_date, MAX(date) AS last_date FROM hourly_counts WHERE station_id = ? AND date BETWEEN ? AND ? GROUP BY sci_name ORDER BY n DESC, com_name')
    .bind(station, from, to)
    .all<{ sci_name: string; com_name: string; n: number; first_date: string; last_date: string }>();
  return results;
}

async function todayStats(db: D1Database, station: string, date: string) {
  const r = await db.prepare('SELECT COUNT(*) AS n, COUNT(DISTINCT sci_name) AS species, MIN(time) AS first_time, MAX(time) AS last_time FROM detections WHERE station_id = ? AND date = ?').bind(station, date).first<{ n: number; species: number; first_time: string | null; last_time: string | null }>();
  return { detections: r?.n ?? 0, species: r?.species ?? 0, first_time: r?.first_time ?? null, latest_time: r?.last_time ?? null };
}

/** "Busier than yesterday, 168 vs 131 by 09:15" and "About usual for mid-October". */
async function comparison(db: D1Database, station: string, date: string, upToTime: string | null) {
  const timeClause = upToTime ? 'AND time <= ?' : '';
  const binds = (d: string) => (upToTime ? [station, d, upToTime] : [station, d]);
  const yesterday = addDays(date, -1);
  const [t, y] = await db.batch([
    db.prepare(`SELECT COUNT(*) AS n FROM detections WHERE station_id = ? AND date = ? ${timeClause}`).bind(...binds(date)),
    db.prepare(`SELECT COUNT(*) AS n FROM detections WHERE station_id = ? AND date = ? ${timeClause}`).bind(...binds(yesterday)),
  ]);
  const todayN = (t.results[0] as { n: number }).n;
  const yN = (y.results[0] as { n: number }).n;
  // Typical: same calendar window (+/- 7 days) in earlier years, up to the same time.
  // The dates are spelled out so the date index can be used (at most 6 years, which
  // keeps the bind count under D1's 100).
  const first = await db.prepare('SELECT MIN(date) AS d FROM hourly_counts WHERE station_id = ?').bind(station).first<{ d: string | null }>();
  const dates: string[] = [];
  const thisYear = Number(date.slice(0, 4));
  const firstYear = first?.d ? Math.max(Number(first.d.slice(0, 4)), thisYear - 6) : thisYear;
  for (let y = firstYear; y < thisYear; y++) {
    const base = `${y}-${date.slice(5) === '02-29' ? '02-28' : date.slice(5)}`;
    for (let i = -7; i <= 7; i++) dates.push(addDays(base, i));
  }
  const inList = dates.map(() => '?').join(',');
  const typ = !dates.length ? { results: [] as { date: string; n: number }[] } : upToTime
    ? await db.prepare(`SELECT date, COUNT(*) AS n FROM detections WHERE station_id = ? AND date IN (${inList}) AND time <= ? GROUP BY date`).bind(station, ...dates, upToTime).all<{ date: string; n: number }>()
    : await db.prepare(`SELECT date, SUM(n) AS n FROM hourly_counts WHERE station_id = ? AND date IN (${inList}) GROUP BY date`).bind(station, ...dates).all<{ date: string; n: number }>();
  const vals = typ.results.map((r) => r.n).sort((a, b) => a - b);
  const pct = (p: number) => (vals.length ? vals[Math.min(vals.length - 1, Math.floor(p * vals.length))] : null);
  const p25 = pct(0.25), p75 = pct(0.75);
  const day = Number(date.slice(8, 10));
  const part = day <= 10 ? 'early' : day <= 20 ? 'mid' : 'late';
  const monthPhrase = `${part}-${MONTHS[Number(date.slice(5, 7)) - 1]}`;
  const vsY = yN === 0 && todayN === 0 ? 'About the same as' : todayN > yN * 1.15 ? 'Busier than' : todayN < yN * 0.85 ? 'Quieter than' : 'About the same as';
  const vsT = p25 == null || p75 == null ? null : todayN > p75 ? 'Busier than usual' : todayN < p25 ? 'Quieter than usual' : 'About usual';
  const by = upToTime ? ` by ${upToTime.slice(0, 5)}` : '';
  return {
    today: todayN,
    yesterday: yN,
    yesterday_label: vsY + ' yesterday',
    yesterday_detail: `${todayN} vs ${yN}${by}`,
    typical_label: vsT ? `${vsT} for ${monthPhrase}` : null,
    typical_detail: vsT ? `Typical ${p25} to ${p75}${by}` : null,
    typical_sample_days: vals.length,
    up_to: upToTime,
  };
}

function clipRow(r: q.DetectionRow) {
  return {
    file_name: r.file_name, date: r.date, time: r.time, confidence: r.confidence,
    audio: r.has_audio ? `/media/${r.media_key}` : null,
    audio_shifted: r.has_shifted ? `/media/${r.media_key.replace('by_date/', 'by_date/shifted/')}` : null,
    png: r.has_png ? `/media/${r.media_key}.png` : null,
    sci_name: r.sci_name, com_name: r.com_name, slug: slugOf(r.sci_name),
  };
}

async function bestClip(db: D1Database, station: string, sci: string, from?: string, to?: string) {
  const where = from ? 'AND date BETWEEN ? AND ?' : '';
  const binds = from ? [station, sci, from, to as string] : [station, sci];
  const r = await db.prepare(`SELECT id, date, time, sci_name, com_name, confidence, file_name, com_name_safe, media_key, has_audio, has_png, has_shifted, locked, on_pi FROM detections WHERE station_id = ? AND sci_name = ? ${where} ORDER BY has_audio DESC, confidence DESC, date DESC, time DESC LIMIT 1`).bind(...binds).first<q.DetectionRow>();
  return r ? clipRow(r) : null;
}

// ---- endpoints --------------------------------------------------------------------

/** Site chrome: settings, station status, today's sun. */
journal.get('/site', async (c) => {
  const x = await ctx(c);
  const lastSeen = x.st?.last_seen_at ? Date.parse(x.st.last_seen_at) : 0;
  const lastSeenLocal = lastSeen ? localTime(x.tz, new Date(lastSeen)).slice(0, 5) : null;
  const s = x.settings;
  return c.json({
    site_name: s.site_name || x.st?.name || 'BirdNET-Pi',
    tagline: s.site_tagline || '',
    footer_blurb: s.footer_blurb || '',
    weather_url: s.weather_url || '',
    weather_label: s.weather_label || 'Weather',
    stream_url: s.stream_url || '',
    chat_enabled: s.chat_enabled === '1',
    today: x.today,
    now: x.now,
    timezone: x.tz,
    station: {
      online: lastSeen > 0 && Date.now() - lastSeen < 10 * 60_000,
      last_seen_at: x.st?.last_seen_at ?? null,
      last_seen_local: lastSeenLocal,
      last_detection_at: x.st?.last_detection_at ?? null,
    },
    sun: sunTimes(x.today, x.st?.lat, x.st?.lon, x.tz),
  });
});

/** Home: this week at the station. */
journal.get('/home', async (c) => {
  const x = await ctx(c);
  const db = c.env.DB;
  const weekFrom = addDays(x.today, -6), weekTo = x.today;
  const lastFrom = addDays(x.today, -13), lastTo = addDays(x.today, -7);
  const [week, last, todayC, stats, cmp, cond] = await Promise.all([
    countsIn(db, x.station, weekFrom, weekTo),
    countsIn(db, x.station, lastFrom, lastTo),
    countsIn(db, x.station, x.today, x.today),
    todayStats(db, x.station, x.today),
    comparison(db, x.station, x.today, x.now),
    currentConditions(x.settings.weather_api_url || ''),
  ]);
  const todayMap = new Map(todayC.map((r) => [r.sci_name, r.n]));
  const lastMap = new Map(last.map((r) => [r.sci_name, r]));
  const weekMap = new Map(week.map((r) => [r.sci_name, r]));
  const levels = await monthLevels(db, x.station, week.map((r) => r.sci_name));
  const plates = await Promise.all(week.map(async (r) => {
    const lv = levels.get(r.sci_name) ?? { levels: new Array(12).fill(0), avg: [] };
    return {
      sci_name: r.sci_name, com_name: r.com_name, slug: slugOf(r.sci_name),
      week: r.n, today: todayMap.get(r.sci_name) ?? 0,
      levels: lv.levels, presence: presenceLine(lv.levels),
      best: await bestClip(db, x.station, r.sci_name, weekFrom, weekTo),
    };
  }));
  const top = plates[0] ?? null;
  const heroBest = top ? (await bestClip(db, x.station, top.sci_name, x.today, x.today)) ?? top.best : null;
  const rarest = plates.length ? plates.reduce((a, b) => (b.week < a.week ? b : a)) : null;
  const newThisWeek = week.filter((r) => !lastMap.has(r.sci_name)).map((r) => ({ sci_name: r.sci_name, com_name: r.com_name, slug: slugOf(r.sci_name), first_date: r.first_date }));
  const quiet = last.filter((r) => !weekMap.has(r.sci_name)).map((r) => ({ sci_name: r.sci_name, com_name: r.com_name, last_date: r.last_date }));
  // "Back since" for species that were absent last week but known before
  for (const n of newThisWeek) {
    const prior = await db.prepare('SELECT 1 FROM detections WHERE station_id = ? AND sci_name = ? AND date < ? LIMIT 1').bind(x.station, n.sci_name, lastFrom).first();
    (n as { returning?: boolean }).returning = !!prior;
  }
  return c.json({
    today: x.today, now: x.now, week: { from: weekFrom, to: weekTo }, last_week: { from: lastFrom, to: lastTo },
    sun: sunTimes(x.today, x.st?.lat, x.st?.lon, x.tz),
    conditions: cond,
    today_stats: stats,
    comparison: cmp,
    hero: top ? { ...top, best: heroBest } : null,
    mosaic: { most: top, runner_up: plates[1] ?? null, rarest },
    plates,
    new_this_week: newThisWeek,
    quiet_this_week: quiet,
  });
});

/** Every species ever heard, A to Z, with this week's counts (search page and type-ahead). */
journal.get('/species', async (c) => {
  const x = await ctx(c);
  const weekFrom = addDays(x.today, -6);
  const { results } = await c.env.DB
    .prepare(`SELECT sci_name, MAX(com_name) AS com_name, SUM(n) AS total, MIN(date) AS first_date, MAX(date) AS last_date,
                     SUM(CASE WHEN date >= ? THEN n ELSE 0 END) AS week
              FROM hourly_counts WHERE station_id = ? GROUP BY sci_name ORDER BY com_name COLLATE NOCASE`)
    .bind(weekFrom, x.station)
    .all<{ sci_name: string; com_name: string; total: number; first_date: string; last_date: string; week: number }>();
  return c.json({ total: results.length, items: results.map((r) => ({ ...r, slug: slugOf(r.sci_name) })) });
});

/** Species page. :slug is the slug of the scientific name, or the exact scientific name. */
journal.get('/species/:slug', async (c) => {
  const x = await ctx(c);
  const db = c.env.DB;
  const slug = c.req.param('slug');
  const all = await db.prepare('SELECT sci_name, MAX(com_name) AS com_name, SUM(n) AS total, MIN(date) AS first_date, MAX(date) AS last_date FROM hourly_counts WHERE station_id = ? GROUP BY sci_name')
    .bind(x.station).all<{ sci_name: string; com_name: string; total: number; first_date: string; last_date: string }>();
  const want = slug.toLowerCase();
  const sp = all.results.find((r) => r.sci_name === slug || slugOf(r.sci_name) === want || r.sci_name.toLowerCase().replace(/ /g, '-').replace(/\./g, '') === want);
  if (!sp) return c.json({ error: 'not found' }, 404);
  const lastT = await db.prepare('SELECT MAX(time) AS t FROM detections WHERE station_id = ? AND sci_name = ? AND date = ?').bind(x.station, sp.sci_name, sp.last_date).first<{ t: string | null }>();
  const lastDt = `${sp.last_date} ${lastT?.t ?? '00:00:00'}`;
  const weekFrom = addDays(x.today, -6);
  const [lv, hours, best, week, weekCount, links] = await Promise.all([
    monthLevels(db, x.station, [sp.sci_name]),
    hoursAllTime(db, x.station, sp.sci_name),
    db.prepare(`SELECT id, date, time, sci_name, com_name, confidence, file_name, com_name_safe, media_key, has_audio, has_png, has_shifted, locked, on_pi FROM detections WHERE station_id = ? AND sci_name = ? AND has_audio = 1 ORDER BY confidence DESC, date DESC, time DESC LIMIT 6`).bind(x.station, sp.sci_name).all<q.DetectionRow>(),
    countsIn(db, x.station, weekFrom, x.today),
    db.prepare('SELECT SUM(n) AS n, SUM(CASE WHEN date = ? THEN n ELSE 0 END) AS today FROM hourly_counts WHERE station_id = ? AND sci_name = ? AND date >= ?').bind(x.today, x.station, sp.sci_name, weekFrom).first<{ n: number; today: number }>(),
    speciesLinks(db, x.station, x.settings, sp.sci_name),
  ]);
  const levels = lv.get(sp.sci_name)?.levels ?? new Array(12).fill(0);
  const u = usualTime(hours);
  const more = week.filter((r) => r.sci_name !== sp.sci_name).slice(0, 9).map((r) => ({ sci_name: r.sci_name, com_name: r.com_name, slug: slugOf(r.sci_name), week: r.n }));
  return c.json({
    sci_name: sp.sci_name, com_name: sp.com_name, slug: slugOf(sp.sci_name),
    total: sp.total, first_date: sp.first_date, last_date: sp.last_date, last_time: lastDt.slice(11, 16),
    week: weekCount?.n ?? 0, today: weekCount?.today ?? 0,
    levels, presence: presenceLine(levels),
    hours, usual: u,
    sun: sunTimes(x.today, x.st?.lat, x.st?.lon, x.tz),
    best: best.results.map(clipRow),
    more_this_week: more,
    links: { all_about_birds: links.info_title === 'All About Birds' ? links.info : `https://www.allaboutbirds.org/guide/${(links.com_en_name || sp.com_name).replace(/'/g, '').replace(/ /g, '_')}`, wikipedia: links.wikipedia, ebird: `https://ebird.org/species/search?q=${encodeURIComponent(sp.sci_name)}` },
    today_date: x.today,
  });
});

/** Photos with credits: main plus up to three gallery images. */
journal.get('/photos/:sci', async (c) => {
  const x = await ctx(c);
  const sci = c.req.param('sci');
  const provider = (x.settings.image_provider ?? 'wikipedia') as 'wikipedia' | 'flickr' | 'none';
  const label = await c.env.DB.prepare('SELECT com_en_name, com_name FROM labels WHERE station_id = ? AND sci_name = ?').bind(x.station, sci).first<{ com_en_name: string | null; com_name: string }>();
  const name = label?.com_en_name || label?.com_name || '';
  const main = await getSpeciesImage(c.env.DB, provider, sci, name, c.env.FLICKR_API_KEY, x.settings.flickr_filter_email || undefined);
  const credit = (p: { provider?: string; author_name?: string; license_name?: string; author_url?: string; photos_url?: string; license_url?: string }) => {
    const src = p.provider === 'wikipedia' ? 'Wikimedia Commons' : 'Flickr';
    const who = p.author_name || (p.provider === 'wikipedia' ? 'Wikimedia Commons' : 'Flickr user');
    return { text: `Photo: ${who} on ${src}${p.license_name ? ', ' + p.license_name : ''}`, link: p.photos_url || p.author_url || '', license_url: p.license_url || '' };
  };
  let gallery: unknown[] = [];
  if (c.env.FLICKR_API_KEY && c.req.query('gallery') !== '0') {
    try {
      const g = await flickrGallery(c.env.FLICKR_API_KEY, name || sci);
      gallery = g.filter((p) => p.id !== main?.image_id).slice(0, 3).map((p) => ({ ...p, credit: credit(p) }));
    } catch { gallery = []; }
  }
  c.header('cache-control', 'public, max-age=3600');
  return c.json({ main: main ? { ...main, credit: credit(main) } : null, gallery });
});

/** Today or a past day: stats, conditions, comparison, the who-sang-when matrix. */
journal.get('/day/:date', async (c) => {
  const x = await ctx(c);
  const db = c.env.DB;
  const date = c.req.param('date') === 'today' ? x.today : c.req.param('date');
  if (!isValidDate(date)) return c.json({ error: 'bad date' }, 400);
  const isToday = date === x.today;
  const [stats, matrix, cmp, cond] = await Promise.all([
    todayStats(db, x.station, date),
    q.dailyMatrix(db, x.station, date),
    comparison(db, x.station, date, isToday ? x.now : null),
    isToday ? currentConditions(x.settings.weather_api_url || '') : Promise.resolve(null),
  ]);
  const maxCell = Math.max(1, ...matrix.species.flatMap((s) => s.hours));
  return c.json({
    date, is_today: isToday, now: isToday ? x.now : null, now_hour: isToday ? Number(x.now.slice(0, 2)) : null,
    prev: addDays(date, -1), next: date < x.today ? addDays(date, 1) : null,
    stats, sun: sunTimes(date, x.st?.lat, x.st?.lon, x.tz), conditions: cond, comparison: cmp,
    max_cell: maxCell,
    species: matrix.species.map((s) => ({ ...s, slug: slugOf(s.sci_name) })),
  });
});

/** Clips for one species in one hour (dot grid and hour chips). */
journal.get('/clips', async (c) => {
  const x = await ctx(c);
  const date = c.req.query('date') === 'today' || !c.req.query('date') ? x.today : (c.req.query('date') as string);
  const sci = c.req.query('sci') ?? '';
  const hour = c.req.query('hour');
  if (!isValidDate(date) || !sci) return c.json({ error: 'date and sci required' }, 400);
  const limit = Math.min(Number(c.req.query('limit') ?? 12), 100);
  const h = hour != null ? `AND substr(time,1,2) = '${p2(Number(hour))}'` : '';
  const { results } = await c.env.DB
    .prepare(`SELECT id, date, time, sci_name, com_name, confidence, file_name, com_name_safe, media_key, has_audio, has_png, has_shifted, locked, on_pi FROM detections WHERE station_id = ? AND date = ? AND sci_name = ? ${h} ORDER BY time DESC LIMIT ?`)
    .bind(x.station, date, sci, limit)
    .all<q.DetectionRow>();
  return c.json({ items: results.map(clipRow) });
});

/** One recording with the conditions at that moment. */
journal.get('/recording/:file_name', async (c) => {
  const x = await ctx(c);
  const row = await q.detectionByFile(c.env.DB, x.station, c.req.param('file_name'));
  if (!row) return c.json({ error: 'not found' }, 404);
  // The row's date and time are station-local; convert to a unix timestamp.
  const tsUtc = Math.floor(Date.parse(`${row.date}T${row.time}Z`) / 1000) - tzOffsetMinutes(x.tz, row.date) * 60;
  const cond = await conditionsAt(x.settings.weather_api_url || '', tsUtc);
  return c.json({ ...clipRow(row), conditions: cond, locked: row.locked, on_pi: row.on_pi });
});

/** Archive month: species and detection counts per day. */
journal.get('/archive/:ym', async (c) => {
  const x = await ctx(c);
  const ym = c.req.param('ym');
  if (!/^\d{4}-\d{2}$/.test(ym)) return c.json({ error: 'bad month' }, 400);
  const { results } = await c.env.DB
    .prepare('SELECT date, SUM(n) AS detections, COUNT(DISTINCT sci_name) AS species FROM hourly_counts WHERE station_id = ? AND date BETWEEN ? AND ? GROUP BY date')
    .bind(x.station, `${ym}-01`, `${ym}-31`)
    .all<{ date: string; detections: number; species: number }>();
  const bounds = await c.env.DB.prepare('SELECT MIN(date) AS first, MAX(date) AS last FROM hourly_counts WHERE station_id = ?').bind(x.station).first<{ first: string | null; last: string | null }>();
  const [y, m] = ym.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const byDate = new Map(results.map((r) => [r.date, r]));
  const days = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${ym}-${p2(d)}`;
    const r = byDate.get(date);
    days.push({ date, day: d, detections: r?.detections ?? 0, species: r?.species ?? 0, future: date > x.today, is_today: date === x.today });
  }
  const maxSpecies = Math.max(1, ...days.map((d) => d.species));
  return c.json({
    month: ym, title: `${MONTHS[m - 1]} ${y}`, first_weekday: first.getUTCDay(), days, max_species: maxSpecies,
    today: x.today, first_month: bounds?.first?.slice(0, 7) ?? ym, current_month: x.today.slice(0, 7),
    prev: `${m === 1 ? y - 1 : y}-${p2(m === 1 ? 12 : m - 1)}`, next: ym < x.today.slice(0, 7) ? `${m === 12 ? y + 1 : y}-${p2(m === 12 ? 1 : m + 1)}` : null,
  });
});

/** Day summary for the archive side panel: top 5 species. */
journal.get('/archive/day/:date', async (c) => {
  const x = await ctx(c);
  const date = c.req.param('date');
  if (!isValidDate(date)) return c.json({ error: 'bad date' }, 400);
  const [stats, top] = await Promise.all([
    todayStats(c.env.DB, x.station, date),
    c.env.DB.prepare('SELECT sci_name, com_name, COUNT(*) AS n FROM detections WHERE station_id = ? AND date = ? GROUP BY sci_name ORDER BY n DESC LIMIT 5').bind(x.station, date).all<{ sci_name: string; com_name: string; n: number }>(),
  ]);
  return c.json({ date, is_today: date === x.today, stats, top: top.results.map((r) => ({ ...r, slug: slugOf(r.sci_name) })) });
});

/** Listen live: what was heard in the last 15 minutes, with a fallback. */
journal.get('/live', async (c) => {
  const x = await ctx(c);
  const db = c.env.DB;
  const since = localTime(x.tz, new Date(Date.now() - 15 * 60_000));
  const recent = await db.prepare("SELECT sci_name, MAX(com_name) AS com_name, MAX(time) AS last_time, COUNT(*) AS n FROM detections WHERE station_id = ? AND date = ? AND time >= ? GROUP BY sci_name ORDER BY last_time DESC").bind(x.station, x.today, since).all<{ sci_name: string; com_name: string; last_time: string; n: number }>();
  const last = await db.prepare("SELECT sci_name, com_name, date, time FROM detections WHERE station_id = ? ORDER BY date DESC, time DESC LIMIT 40").bind(x.station).all<{ sci_name: string; com_name: string; date: string; time: string }>();
  const seen = new Set<string>();
  const fallback = [];
  for (const r of last.results) { if (seen.has(r.sci_name)) continue; seen.add(r.sci_name); fallback.push({ ...r, slug: slugOf(r.sci_name) }); if (fallback.length === 4) break; }
  const live = await db.prepare('SELECT file_name, timestamp, delay, detections, pushed_at FROM live_analysis WHERE station_id = ?').bind(x.station).first<{ file_name: string; timestamp: string; delay: number; detections: string; pushed_at: string }>();
  const spec = await c.env.MEDIA.head('live/spectrogram.png');
  return c.json({
    now: x.now, since: since.slice(0, 5), stream_url: x.settings.stream_url || '',
    recent: recent.results.map((r) => ({ ...r, slug: slugOf(r.sci_name) })),
    last_heard: fallback, last_detection_time: fallback[0] ? (fallback[0].date === x.today ? fallback[0].time.slice(0, 5) : `${fallback[0].date} ${fallback[0].time.slice(0, 5)}`) : null,
    spectrogram: spec ? { url: '/media/live/spectrogram.png', uploaded: spec.uploaded.toISOString() } : null,
    overlay: live ? { file_name: live.file_name, timestamp: live.timestamp, delay: live.delay, detections: JSON.parse(live.detections), age_seconds: Math.max(0, Math.round((Date.now() - Date.parse(live.timestamp)) / 1000)) } : null,
  });
});

export default journal;
