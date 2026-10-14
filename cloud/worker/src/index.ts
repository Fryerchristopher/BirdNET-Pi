/**
 * BirdNET-Pi Cloud Worker.
 *
 *   /ingest/*        the Pi agent pushes here (bearer INGEST_TOKEN)
 *   /api/v1/*        public JSON API the UI (yours or the default) reads
 *   /api/v1/admin/*  mutations (Cloudflare Access or ADMIN_TOKEN)
 *   /media/*         audio, spectrograms, charts from R2
 *   /theme.css       the CSS of the theme selected in settings
 *   /stream          302 to the configured live stream URL, if any
 *   everything else  static files from ../web (the default UI)
 */
import { Hono } from 'hono';
import type { AppEnv, Env } from './env';
import ingest from './routes/ingest';
import api from './routes/api';
import admin from './routes/admin';
import media from './routes/media';
import chat from './routes/chat';
import journal from './routes/journal';
import { getSettings, weeklyReport, stationTz } from './lib/db';
import { localDate } from './lib/time';
import { postWebhook } from './lib/notify';
import { publicJson } from './lib/public';

const app = new Hono<AppEnv>();

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'internal error', detail: String(err?.message ?? err) }, 500);
});

// Public JSON: round station coordinates, drop secrets (admin routes excluded).
app.use('/api/v1/*', publicJson);
app.route('/ingest', ingest);
app.route('/api/v1/admin', admin);
app.route('/api/v1/chat', chat);
app.route('/api/v1/journal', journal);
app.route('/api/v1', api);
app.route('/media', media);

/** Theme CSS: /css/themes/<theme>.css from the assets, chosen in settings. ?theme= previews another. */
app.get('/theme.css', async (c) => {
  const s = await getSettings(c.env.DB);
  const requested = c.req.query('theme') ?? s.theme ?? 'default';
  const theme = /^[a-z0-9-]+$/.test(requested) ? requested : 'default';
  let res = await c.env.ASSETS.fetch(new Request(new URL(`/css/themes/${theme}.css`, c.req.url)));
  if (!res.ok) res = await c.env.ASSETS.fetch(new Request(new URL('/css/themes/default.css', c.req.url)));
  const h = new Headers(res.headers);
  h.set('content-type', 'text/css; charset=utf-8');
  h.set('cache-control', 'public, max-age=300');
  h.set('x-theme', theme);
  return new Response(res.body, { status: 200, headers: h });
});

/** Live audio. The Pi keeps icecast; expose it (Cloudflare Tunnel) and set stream_url. */
app.get('/stream', async (c) => {
  const s = await getSettings(c.env.DB);
  if (!s.stream_url) return c.text('No live stream configured. Set stream_url in Admin > Settings.', 404);
  return c.redirect(s.stream_url, 302);
});

/** Deep links from the Pi era: /?filename=<File_Name> and /index.php?filename= */
app.get('/index.php', (c) => c.redirect(`/${c.req.url.includes('?') ? '?' + c.req.url.split('?')[1] : ''}`, 301));
app.get('/views.php', (c) => {
  const view = (c.req.query('view') ?? 'Overview').toLowerCase();
  const map: Record<string, string> = {
    'overview': '/', 'todays detections': '/today', 'kiosk': '/today?kiosk=1', 'spectrogram': '/spectrogram',
    'species stats': '/best', 'streamlit': '/stats', 'daily charts': '/daily', 'weekly report': '/weekly',
    'recordings': '/recordings', 'tools': '/admin', 'settings': '/admin', 'species management': '/admin/species',
  };
  const target = map[view] ?? '/';
  const date = c.req.query('date');
  const species = c.req.query('species');
  const u = new URL(target, c.req.url);
  if (date) u.searchParams.set('date', date);
  if (species) u.searchParams.set('species', species);
  if (c.req.query('filename')) { u.pathname = '/recordings'; u.searchParams.set('file', c.req.query('filename') as string); }
  return c.redirect(u.pathname + u.search, 301);
});

app.get('*', async (c) => {
  const url = new URL(c.req.url);
  // The old deep link: index.php?filename=X -> /recordings?file=X
  if (url.pathname === '/' && url.searchParams.get('filename')) {
    return c.redirect(`/recordings?file=${encodeURIComponent(url.searchParams.get('filename') as string)}`, 302);
  }
  // Admin pages are static HTML too; the auth happens in the API they call.
  // With ADMIN_AUTH=access, Cloudflare Access protects /admin* at the edge.
  const res = await c.env.ASSETS.fetch(c.req.raw);
  // Client-side routes (the Field Journal UI uses /species/:slug, /day/:date, ...):
  // an unknown extension-less path gets the app shell instead of a 404.
  if (res.status === 404 && !/\.[a-z0-9]+$/i.test(url.pathname) && (c.req.header('accept') ?? '').includes('text/html')) {
    const shell = await c.env.ASSETS.fetch(new Request(new URL('/index.html', c.req.url)));
    if (shell.ok) return new Response(shell.body, { status: 200, headers: shell.headers });
  }
  return res;
});

export default {
  fetch: app.fetch,

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runScheduled(event.cron, env));
  },
};

async function runScheduled(cron: string, env: Env) {
  if (cron === '0 8 * * 1') {
    // Weekly report webhook.
    const s = await getSettings(env.DB);
    if (!env.NOTIFY_WEBHOOK || s.notify_weekly_report !== '1') return;
    const { results } = await env.DB.prepare('SELECT id FROM stations').all<{ id: string }>();
    for (const st of results) {
      const tz = await stationTz(env.DB, st.id);
      const r = await weeklyReport(env.DB, st.id, localDate(tz));
      const pct = (p: number | null) => (p === null ? 'new' : `${p >= 0 ? '+' : ''}${p}%`);
      const lines = [
        `Total Detections: ${r.total} (${pct(r.total_change_pct)})`,
        `Unique Species Detected: ${r.species_count} (${pct(r.species_change_pct)})`,
        '', '= Top 10 Species =',
        ...r.top.map((t) => `${t.com_name} - ${t.count} (${pct(t.change_pct)})`),
        '', '= Species Detected for the First Time =',
        ...(r.first_seen.length ? r.first_seen.map((t) => `${t.com_name} - ${t.count}`) : ['No new species were seen this week.']),
        '', `* data from ${r.start} to ${r.end}.`, `* percentages are calculated relative to week ${r.week - 1}.`,
      ];
      await postWebhook(env.NOTIFY_WEBHOOK, { type: 'weekly_report', station: st.id, title: `BirdNET-Pi: Week ${r.week} Report`, body: lines.join('\n'), report: r });
    }
  } else {
    // Hourly housekeeping: drop expired image cache rows, forget stale taken commands.
    await env.DB.prepare("DELETE FROM species_images WHERE expires_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days')").run();
    await env.DB.prepare("UPDATE commands SET status = 'pending', taken_at = NULL WHERE status = 'taken' AND taken_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour')").run();
  }
}
