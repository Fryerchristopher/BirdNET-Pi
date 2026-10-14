/**
 * /api/v1/admin/*  Mutations. Guarded by requireAdmin (see lib/auth.ts).
 *
 * Anything that touches files on the Pi becomes a command the agent picks up;
 * the D1 side effect is applied when the Pi acks (routes/ingest.ts). Things
 * that live only in the cloud (settings, image blacklist, species lists) are
 * applied immediately, and list changes also enqueue sync_lists so the Pi's
 * text files follow.
 */
import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { requireAdmin } from '../lib/auth';
import * as q from '../lib/db';
import { piRelativePath } from '../lib/names';

const admin = new Hono<AppEnv>();
admin.use('*', requireAdmin);
admin.use('*', async (c, next) => {
  const s = c.req.query('station') ?? 'default';
  c.set('station', /^[A-Za-z0-9_-]{1,64}$/.test(s) ? s : 'default');
  await next();
});

const SETTING_KEYS = new Set([
  'site_name', 'site_url', 'theme', 'image_provider', 'info_site', 'language', 'rare_species_threshold', 'recording_length',
  'stream_url', 'flickr_filter_email', 'public_admin_links',
  'notify_title', 'notify_each_detection', 'notify_first_of_day', 'notify_new_species', 'notify_min_seconds_per_species',
  'notify_exclude_species', 'notify_only_species', 'notify_weekly_report',
  'chat_enabled', 'chat_model', 'chat_intro', 'chat_daily_budget', 'chat_per_ip_per_hour', 'chat_per_ip_per_day',
]);

admin.get('/settings', async (c) => c.json(await q.getSettings(c.env.DB)));

admin.put('/settings', async (c) => {
  const b = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return c.json({ error: 'json body required' }, 400);
  const values: Record<string, string> = {};
  for (const [k, v] of Object.entries(b)) if (SETTING_KEYS.has(k)) values[k] = String(v ?? '');
  await q.setSettings(c.env.DB, values);
  return c.json({ ok: true, updated: Object.keys(values) });
});

/** Whoami, used by the admin UI to test a token. */
admin.get('/me', (c) => c.json({ admin: true, mode: c.env.ADMIN_AUTH }));

// ---- detections ----------------------------------------------------------

async function rowOr404(c: { env: AppEnv['Bindings']; get: (k: 'station') => string; req: { param: (k: string) => string } }) {
  return q.detectionByFile(c.env.DB, c.get('station'), c.req.param('file_name'));
}

admin.post('/detections/:file_name/delete', async (c) => {
  const row = await rowOr404(c);
  if (!row) return c.json({ error: 'not found' }, 404);
  const station = c.get('station');
  if (row.on_pi) {
    const id = await q.enqueueCommand(c.env.DB, station, 'delete_file', { file_name: row.file_name, path: piRelativePath(row.date, row.com_name, row.file_name) });
    return c.json({ ok: true, queued: id });
  }
  // Already gone from the Pi: delete here directly.
  await c.env.MEDIA.delete([row.media_key, row.media_key + '.png', row.media_key.replace('by_date/', 'by_date/shifted/')]);
  await c.env.DB.prepare('DELETE FROM detections WHERE station_id = ? AND file_name = ?').bind(station, row.file_name).run();
  return c.json({ ok: true, deleted: true });
});

admin.post('/detections/:file_name/lock', async (c) => lockToggle(c, 1));
admin.post('/detections/:file_name/unlock', async (c) => lockToggle(c, 0));
async function lockToggle(c: Parameters<typeof rowOr404>[0] & { json: (o: unknown, s?: number) => Response }, locked: number) {
  const row = await rowOr404(c);
  if (!row) return c.json({ error: 'not found' }, 404);
  const station = c.get('station');
  await c.env.DB.prepare('UPDATE detections SET locked = ? WHERE station_id = ? AND file_name = ?').bind(locked, station, row.file_name).run();
  const id = await q.enqueueCommand(c.env.DB, station, locked ? 'lock' : 'unlock', { file_name: row.file_name, path: piRelativePath(row.date, row.com_name, row.file_name) });
  return c.json({ ok: true, locked, queued: id });
}

admin.post('/detections/:file_name/shift', async (c) => {
  const row = await rowOr404(c);
  if (!row) return c.json({ error: 'not found' }, 404);
  const id = await q.enqueueCommand(c.env.DB, c.get('station'), 'shift', { file_name: row.file_name, path: piRelativePath(row.date, row.com_name, row.file_name), media_key: row.media_key });
  return c.json({ ok: true, queued: id });
});

admin.post('/detections/:file_name/unshift', async (c) => {
  const row = await rowOr404(c);
  if (!row) return c.json({ error: 'not found' }, 404);
  const id = await q.enqueueCommand(c.env.DB, c.get('station'), 'unshift', { file_name: row.file_name, path: piRelativePath(row.date, row.com_name, row.file_name) });
  return c.json({ ok: true, queued: id });
});

/** Re-identify: body { sci_name, com_name } (must exist in labels). */
admin.post('/detections/:file_name/reidentify', async (c) => {
  const row = await rowOr404(c);
  if (!row) return c.json({ error: 'not found' }, 404);
  const b = (await c.req.json().catch(() => null)) as { sci_name?: string; com_name?: string } | null;
  if (!b?.sci_name || !b.com_name) return c.json({ error: 'sci_name and com_name required' }, 400);
  const station = c.get('station');
  const label = await c.env.DB.prepare('SELECT 1 FROM labels WHERE station_id = ? AND sci_name = ? AND com_name = ?').bind(station, b.sci_name, b.com_name).first();
  if (!label) return c.json({ error: 'unknown label' }, 400);
  if (b.com_name === row.com_name) return c.json({ error: 'same species' }, 400);
  const id = await q.enqueueCommand(c.env.DB, station, 'reidentify', {
    file_name: row.file_name,
    path: piRelativePath(row.date, row.com_name, row.file_name),
    sci_name: b.sci_name,
    com_name: b.com_name,
    newname: `${b.sci_name}_${b.com_name}`,
  });
  return c.json({ ok: true, queued: id });
});

// ---- species -------------------------------------------------------------

admin.post('/species/:sci/delete', async (c) => {
  const station = c.get('station');
  const sci = c.req.param('sci');
  const n = await c.env.DB.prepare('SELECT COUNT(*) AS n, SUM(on_pi) AS on_pi FROM detections WHERE station_id = ? AND sci_name = ?').bind(station, sci).first<{ n: number; on_pi: number }>();
  if (!n?.n) return c.json({ error: 'not found' }, 404);
  const id = await q.enqueueCommand(c.env.DB, station, 'delete_species', { sci_name: sci });
  return c.json({ ok: true, queued: id, rows: n.n });
});

/** Species lists: POST /lists/:list { action: add|del, sci_name, com_name? } */
admin.post('/lists/:list', async (c) => {
  const list = c.req.param('list');
  if (!['include', 'exclude', 'whitelist', 'confirmed'].includes(list)) return c.json({ error: 'bad list' }, 400);
  const b = (await c.req.json().catch(() => null)) as { action?: string; sci_name?: string; com_name?: string } | null;
  if (!b?.sci_name || !['add', 'del'].includes(b.action ?? '')) return c.json({ error: 'action and sci_name required' }, 400);
  const station = c.get('station');
  let com = b.com_name ?? '';
  if (!com) {
    const l = await c.env.DB.prepare('SELECT com_name FROM labels WHERE station_id = ? AND sci_name = ?').bind(station, b.sci_name).first<{ com_name: string }>();
    com = l?.com_name ?? '';
  }
  if (b.action === 'add') {
    await c.env.DB.prepare('INSERT OR REPLACE INTO species_lists (station_id, list, sci_name, com_name) VALUES (?, ?, ?, ?)').bind(station, list, b.sci_name, com).run();
  } else {
    await c.env.DB.prepare('DELETE FROM species_lists WHERE station_id = ? AND list = ? AND sci_name = ?').bind(station, list, b.sci_name).run();
  }
  const lists = await q.listLists(c.env.DB, station);
  const id = await q.enqueueCommand(c.env.DB, station, 'sync_lists', lists);
  return c.json({ ok: true, queued: id, lists });
});

admin.post('/images/blacklist', async (c) => {
  const b = (await c.req.json().catch(() => null)) as { image_id?: string } | null;
  if (!b?.image_id) return c.json({ error: 'image_id required' }, 400);
  await c.env.DB.prepare('INSERT OR IGNORE INTO blacklisted_images (image_id) VALUES (?)').bind(String(b.image_id)).run();
  await c.env.DB.prepare('DELETE FROM species_images WHERE image_id = ?').bind(String(b.image_id)).run();
  return c.json({ ok: true });
});

// ---- commands ------------------------------------------------------------

admin.get('/commands', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM commands WHERE station_id = ? ORDER BY id DESC LIMIT 100').bind(c.get('station')).all();
  return c.json({ items: results });
});

const SERVICE_ALLOW = new Set([
  'birdnet_analysis', 'birdnet_recording', 'chart_viewer', 'spectrogram_viewer', 'livestream', 'icecast2', 'birdnet_log', 'birdnet_stats', 'web_terminal', 'birdnet_cloud_agent',
]);

/** POST /commands { kind: restart_service|stop_service|start_service|sync_lists|run, service?, name? } */
admin.post('/commands', async (c) => {
  const b = (await c.req.json().catch(() => null)) as { kind?: string; service?: string; name?: string } | null;
  if (!b?.kind) return c.json({ error: 'kind required' }, 400);
  const station = c.get('station');
  if (['restart_service', 'stop_service', 'start_service'].includes(b.kind)) {
    if (!b.service || !SERVICE_ALLOW.has(b.service)) return c.json({ error: 'service not allowed' }, 400);
    return c.json({ ok: true, queued: await q.enqueueCommand(c.env.DB, station, b.kind, { service: b.service }) });
  }
  if (b.kind === 'sync_lists') return c.json({ ok: true, queued: await q.enqueueCommand(c.env.DB, station, 'sync_lists', await q.listLists(c.env.DB, station)) });
  if (b.kind === 'run') {
    // Named scripts only; the agent maps names to its own allow-list.
    if (!b.name || !/^[a-z_]+$/.test(b.name)) return c.json({ error: 'name required' }, 400);
    return c.json({ ok: true, queued: await q.enqueueCommand(c.env.DB, station, 'run', { name: b.name }) });
  }
  if (b.kind === 'resync') return c.json({ ok: true, queued: await q.enqueueCommand(c.env.DB, station, 'resync', {}) });
  return c.json({ error: 'unknown kind' }, 400);
});

export default admin;
