/**
 * /api/v1/*  Public, read-only JSON. This is the contract a custom front end
 * builds against (see docs/API.md). Everything the default UI shows comes
 * from here; nothing is rendered server-side.
 */
import { Hono } from 'hono';
import type { AppEnv } from '../env';
import * as q from '../lib/db';
import { getSpeciesImage, flickrGallery } from '../lib/images';
import { allAboutBirdsSlug, wikiTitle } from '../lib/names';
import { addDays, isValidDate, localDate, daysBetween } from '../lib/time';
import { isAdmin } from '../lib/auth';

const api = new Hono<AppEnv>();

api.use('*', async (c, next) => {
  const s = c.req.query('station') ?? 'default';
  c.set('station', /^[A-Za-z0-9_-]{1,64}$/.test(s) ? s : 'default');
  c.header('cache-control', 'no-store');
  await next();
});

async function ctx(c: { env: AppEnv['Bindings']; get: (k: 'station') => string }) {
  const station = c.get('station');
  const [tz, settings] = await Promise.all([q.stationTz(c.env.DB, station), q.getSettings(c.env.DB)]);
  return { station, tz, settings, today: localDate(tz) };
}

/** Site + station info the UI needs on every page. */
api.get('/site', async (c) => {
  const { station, settings, today, tz } = await ctx(c);
  const st = await q.stationInfo(c.env.DB, station);
  const lastSeen = st?.last_seen_at ? Date.parse(st.last_seen_at as string) : 0;
  const pub: Record<string, string> = {};
  for (const k of ['site_name', 'theme', 'image_provider', 'info_site', 'language', 'rare_species_threshold', 'recording_length', 'stream_url', 'public_admin_links', 'site_url', 'chat_enabled', 'chat_intro']) {
    if (settings[k] !== undefined) pub[k] = settings[k];
  }
  return c.json({
    settings: pub,
    station: st
      ? {
          id: st.id, name: st.name, timezone: tz, lat: st.lat, lon: st.lon,
          last_seen_at: st.last_seen_at, last_detection_at: st.last_detection_at,
          analyzing_now: st.analyzing_now, pi_version: st.pi_version, agent_version: st.agent_version,
          disk_used_pct: st.disk_used_pct, backlog_files: st.backlog_files,
          online: lastSeen > 0 && Date.now() - lastSeen < 10 * 60_000,
          config: st.config,
        }
      : null,
    today,
    admin: await isAdmin(c),
    flickr_enabled: !!c.env.FLICKR_API_KEY,
  });
});

api.get('/summary', async (c) => {
  const { station, tz } = await ctx(c);
  return c.json(await q.summary(c.env.DB, station, tz));
});

/** Most recent detection that has a spectrogram (Overview card). */
api.get('/detections/recent', async (c) => {
  const { station } = await ctx(c);
  const limit = Math.min(Number(c.req.query('limit') ?? 5), 50);
  const r = await q.listDetections(c.env.DB, station, { limit, sort: 'date' });
  return c.json(r);
});

api.get('/detections/latest', async (c) => {
  const { station } = await ctx(c);
  const row = await q.mostRecent(c.env.DB, station, c.req.query('any') !== '1');
  return c.json(row ?? null);
});

/**
 * GET /api/v1/detections?date=&from=&to=&sci=&com=&q=&sort=date|confidence&limit=&offset=&locked=1&available=1
 * date=today is accepted.
 */
api.get('/detections', async (c) => {
  const { station, today } = await ctx(c);
  const date = c.req.query('date') === 'today' ? today : c.req.query('date');
  if (date && !isValidDate(date)) return c.json({ error: 'bad date' }, 400);
  const r = await q.listDetections(c.env.DB, station, {
    date,
    from: c.req.query('from'),
    to: c.req.query('to'),
    sci: c.req.query('sci'),
    com: c.req.query('com'),
    q: c.req.query('q'),
    sort: c.req.query('sort') === 'confidence' ? 'confidence' : 'date',
    limit: Number(c.req.query('limit') ?? 40),
    offset: Number(c.req.query('offset') ?? 0),
    onlyLocked: c.req.query('locked') === '1',
    onlyAvailable: c.req.query('available') === '1',
  });
  return c.json(r);
});

api.get('/detections/:file_name', async (c) => {
  const { station } = await ctx(c);
  const row = await q.detectionByFile(c.env.DB, station, c.req.param('file_name'));
  return row ? c.json(row) : c.json({ error: 'not found' }, 404);
});

/** GET /api/v1/species?sort=alphabetical|occurrences|confidence|date&date=YYYY-MM-DD|today */
api.get('/species', async (c) => {
  const { station, today } = await ctx(c);
  const sort = (c.req.query('sort') ?? 'alphabetical') as q.Sort;
  const date = c.req.query('date') === 'today' ? today : c.req.query('date');
  if (date && !isValidDate(date)) return c.json({ error: 'bad date' }, 400);
  return c.json({ items: await q.speciesSummary(c.env.DB, station, sort, date) });
});

api.get('/species/manage', async (c) => {
  const { station } = await ctx(c);
  return c.json({ items: await q.speciesManagement(c.env.DB, station) });
});

api.get('/species/:sci/best', async (c) => {
  const { station } = await ctx(c);
  const row = await q.bestDetection(c.env.DB, station, c.req.param('sci'));
  return row ? c.json(row) : c.json({ error: 'not found' }, 404);
});

/** Mini graph: detections per day for the last N days (default 30). */
api.get('/species/:sci/history', async (c) => {
  const { station, today } = await ctx(c);
  const days = Math.min(Math.max(Number(c.req.query('days') ?? 30), 1), 1095);
  return c.json({ days, items: await q.speciesHistory(c.env.DB, station, c.req.param('sci'), today, days) });
});

/** Flickr gallery for Best Recordings (empty when no key). */
api.get('/species/:sci/gallery', async (c) => {
  if (!c.env.FLICKR_API_KEY) return c.json({ items: [] });
  const { station } = await ctx(c);
  const sci = c.req.param('sci');
  const label = await c.env.DB.prepare('SELECT com_en_name, com_name FROM labels WHERE station_id = ? AND sci_name = ?').bind(station, sci).first<{ com_en_name: string | null; com_name: string }>();
  const name = label?.com_en_name || label?.com_name || sci;
  return c.json({ items: await flickrGallery(c.env.FLICKR_API_KEY, name) });
});

/** 302 to the configured info site for a species (All About Birds or eBird). */
api.get('/species/:sci/info', async (c) => {
  const { station, settings } = await ctx(c);
  const l = await speciesLinks(c.env.DB, station, settings, c.req.param('sci'));
  return c.redirect(l.info, 302);
});

/** Links for a species: info site, wikipedia. */
api.get('/species/:sci/links', async (c) => {
  const { station, settings } = await ctx(c);
  return c.json(await speciesLinks(c.env.DB, station, settings, c.req.param('sci')));
});

export async function speciesLinks(db: D1Database, station: string, settings: Record<string, string>, sci: string) {
  const label = await db.prepare('SELECT com_en_name, com_name FROM labels WHERE station_id = ? AND sci_name = ?').bind(station, sci).first<{ com_en_name: string | null; com_name: string }>();
  const en = label?.com_en_name || label?.com_name || '';
  const wikipedia = `https://wikipedia.org/wiki/${wikiTitle(sci)}`;
  let info = en ? `https://allaboutbirds.org/guide/${allAboutBirdsSlug(en)}` : wikipedia;
  let infoTitle = 'All About Birds';
  if (settings.info_site === 'ebird') {
    // eBird species codes are not bundled (the Pi carries a 6,500-line table);
    // the eBird search page resolves a scientific name reliably.
    info = `https://ebird.org/species/search?q=${encodeURIComponent(sci)}&siteLanguage=${settings.language ?? 'en'}`;
    infoTitle = 'eBird';
  }
  return { info, info_title: infoTitle, wikipedia, com_en_name: en };
}

/** Overview: new and rare species today. */
api.get('/today/highlights', async (c) => {
  const { station, today, settings } = await ctx(c);
  return c.json(await q.newAndRare(c.env.DB, station, today, Number(settings.rare_species_threshold ?? 30)));
});

/** Daily Charts data (species x hour) for one date. */
api.get('/daily', async (c) => {
  const { station, today } = await ctx(c);
  const date = c.req.query('date') && c.req.query('date') !== 'today' ? (c.req.query('date') as string) : today;
  if (!isValidDate(date)) return c.json({ error: 'bad date' }, 400);
  const m = await q.dailyMatrix(c.env.DB, station, date);
  const chart = await c.env.DB.prepare('SELECT media_key FROM daily_charts WHERE station_id = ? AND date = ?').bind(station, date).first<{ media_key: string }>();
  return c.json({ ...m, prev: addDays(date, -1), next: addDays(date, 1), is_today: date === today, chart_image: chart ? `/media/${chart.media_key}` : null });
});

api.get('/dates', async (c) => {
  const { station, today } = await ctx(c);
  return c.json({ today, items: await q.dates(c.env.DB, station) });
});

/** Weekly report. ?end=YYYY-MM-DD picks a different week (end is the Saturday). */
api.get('/weekly', async (c) => {
  const { station, today } = await ctx(c);
  const end = c.req.query('end');
  const override = end && isValidDate(end) ? { start: addDays(end, -6), end } : undefined;
  return c.json(await q.weeklyReport(c.env.DB, station, today, override));
});

/** Species Stats (Streamlit replacement). ?from=&to=&sci=&top=10 */
api.get('/stats', async (c) => {
  const { station, today } = await ctx(c);
  const to = c.req.query('to') && isValidDate(c.req.query('to')) ? (c.req.query('to') as string) : today;
  const from = c.req.query('from') && isValidDate(c.req.query('from')) ? (c.req.query('from') as string) : addDays(to, -30);
  if (daysBetween(from, to) > 3660) return c.json({ error: 'range too large' }, 400);
  const top = Math.min(Math.max(Number(c.req.query('top') ?? 10), 1), 200);
  return c.json(await q.rangeStats(c.env.DB, station, from, to, c.req.query('sci') || undefined, top));
});

/** Live spectrogram overlay + "currently analyzing". */
api.get('/live', async (c) => {
  const { station } = await ctx(c);
  const row = await c.env.DB.prepare('SELECT * FROM live_analysis WHERE station_id = ?').bind(station).first<{ file_name: string; timestamp: string; delay: number; detections: string; pushed_at: string }>();
  const st = await c.env.DB.prepare('SELECT analyzing_now, last_seen_at FROM stations WHERE id = ?').bind(station).first<{ analyzing_now: string; last_seen_at: string }>();
  const spec = await c.env.MEDIA.head('live/spectrogram.png');
  return c.json({
    analyzing_now: st?.analyzing_now ?? null,
    spectrogram: spec ? { url: '/media/live/spectrogram.png', uploaded: spec.uploaded.toISOString() } : null,
    live: row
      ? { file_name: row.file_name, timestamp: row.timestamp, delay: row.delay, detections: JSON.parse(row.detections), pushed_at: row.pushed_at,
          age_seconds: Math.max(0, Math.round((Date.now() - Date.parse(row.timestamp)) / 1000)) }
      : null,
  });
});

/** Species image with attribution (was /api/v1/image/<sci>). */
api.get('/image/:sci', async (c) => {
  const { station, settings } = await ctx(c);
  const sci = c.req.param('sci');
  const provider = (settings.image_provider ?? 'wikipedia') as 'wikipedia' | 'flickr' | 'none';
  const label = await c.env.DB.prepare('SELECT com_en_name, com_name FROM labels WHERE station_id = ? AND sci_name = ?').bind(station, sci).first<{ com_en_name: string | null; com_name: string }>();
  const img = await getSpeciesImage(c.env.DB, provider, sci, label?.com_en_name || label?.com_name || '', c.env.FLICKR_API_KEY, settings.flickr_filter_email || undefined);
  if (!img) return c.json({ status: 'error', message: 'No image found' }, 404);
  c.header('cache-control', 'public, max-age=3600');
  return c.json({ status: 'success', data: img });
});

api.get('/labels', async (c) => {
  const { station } = await ctx(c);
  const { results } = await c.env.DB.prepare('SELECT sci_name, com_name, com_en_name FROM labels WHERE station_id = ? ORDER BY com_name COLLATE NOCASE').bind(station).all();
  return c.json({ items: results });
});

api.get('/lists', async (c) => {
  const { station } = await ctx(c);
  return c.json(await q.listLists(c.env.DB, station));
});

/** eBird record-format CSV for one day (history.php export). */
api.get('/ebird.csv', async (c) => {
  const { station, today } = await ctx(c);
  const st = await q.stationInfo(c.env.DB, station);
  const date = c.req.query('date') && c.req.query('date') !== 'today' ? (c.req.query('date') as string) : today;
  if (!isValidDate(date)) return c.text('bad date', 400);
  const p = (k: string, d = '') => c.req.query(k) ?? d;
  const { results } = await c.env.DB.prepare(
    `SELECT com_name, CAST(substr(time,1,2) AS INTEGER) AS hour, COUNT(*) AS n FROM detections
     WHERE station_id = ? AND date = ? AND confidence > 0.75 GROUP BY com_name, hour ORDER BY hour, n DESC`,
  ).bind(station, date).all<{ com_name: string; hour: number; n: number }>();
  const [y, m, d] = date.split('-');
  const lines = results.map((r) =>
    [r.com_name, '', '', '1', '', p('location'), st?.lat ?? '', st?.lon ?? '', `${Number(m)}/${Number(d)}/${y}`,
      `${String(r.hour).padStart(2, '0')}:00`, p('state'), p('country'), p('protocol', 'stationary'), p('num_observers', '1'), '60', 'Y', p('dist_traveled', ''), '', p('notes')]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','),
  );
  c.header('content-type', 'text/csv');
  c.header('content-disposition', `attachment; filename=ebird-${date}.csv`);
  return c.body(lines.join('\n') + '\n');
});

export default api;
