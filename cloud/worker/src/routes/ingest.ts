/**
 * /ingest/*  The Pi agent's endpoints. Bearer INGEST_TOKEN.
 *
 * The Pi is outbound-only: it pushes rows, files and status here, and pulls
 * commands from /ingest/commands. Nothing on the cloud side ever connects to
 * the Pi.
 */
import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { requireIngest } from '../lib/auth';
import { comNameSafe, mediaKey, safeKeySegment } from '../lib/names';
import { nowIso } from '../lib/time';
import { notifyNewDetections } from '../lib/notify';

const ingest = new Hono<AppEnv>();
ingest.use('*', requireIngest);

function stationOf(body: { station?: string } | null, c: { req: { query: (k: string) => string | undefined } }): string {
  const s = body?.station ?? c.req.query('station') ?? 'default';
  return /^[A-Za-z0-9_-]{1,64}$/.test(s) ? s : 'default';
}

interface PiRow {
  Date: string; Time: string; Sci_Name: string; Com_Name: string; Confidence: number;
  Lat?: number; Lon?: number; Cutoff?: number; Week?: number; Sens?: number; Overlap?: number; File_Name: string;
}

/**
 * POST /ingest/detections  { station?, rows: PiRow[] }
 * Rows are the Pi's detections table verbatim (same column names). Upsert on
 * (station, File_Name) so re-sends are harmless.
 */
ingest.post('/detections', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { station?: string; rows?: PiRow[] } | null;
  if (!body?.rows || !Array.isArray(body.rows)) return c.json({ error: 'rows[] required' }, 400);
  const station = stationOf(body, c);
  const rows = body.rows.filter((r) => r && r.Date && r.Time && r.Sci_Name && r.Com_Name && r.File_Name);
  if (rows.length > 500) return c.json({ error: 'max 500 rows per request' }, 413);
  const stmt = c.env.DB.prepare(
    `INSERT INTO detections (station_id, date, time, sci_name, com_name, confidence, lat, lon, cutoff, week, sens, overlap, file_name, com_name_safe, media_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(station_id, file_name) DO UPDATE SET
       sci_name = excluded.sci_name, com_name = excluded.com_name, confidence = excluded.confidence,
       com_name_safe = excluded.com_name_safe, media_key = excluded.media_key`,
  );
  const batch = rows.map((r) =>
    stmt.bind(
      station, r.Date, r.Time, r.Sci_Name, r.Com_Name, Number(r.Confidence),
      r.Lat ?? null, r.Lon ?? null, r.Cutoff ?? null, r.Week ?? null, r.Sens ?? null, r.Overlap ?? null,
      r.File_Name, comNameSafe(r.Com_Name), mediaKey(r.Date, r.Com_Name, r.File_Name),
    ),
  );
  // D1 batches are transactional; keep them modest.
  for (let i = 0; i < batch.length; i += 100) await c.env.DB.batch(batch.slice(i, i + 100));
  const last = rows.reduce((a, r) => (r.Date + ' ' + r.Time > a ? r.Date + ' ' + r.Time : a), '');
  await c.env.DB.prepare('UPDATE stations SET last_seen_at = ?, last_detection_at = COALESCE(MAX(last_detection_at, ?), ?) WHERE id = ?')
    .bind(nowIso(), last, last, station).run();
  c.executionCtx.waitUntil(notifyNewDetections(c.env, station, rows.map((r) => ({ sci_name: r.Sci_Name, com_name: r.Com_Name, date: r.Date, time: r.Time, confidence: Number(r.Confidence), file_name: r.File_Name }))));
  return c.json({ ok: true, upserted: rows.length });
});

/**
 * PUT /ingest/media/<key>   raw body = file bytes
 * key is the R2 key: by_date/<date>/<com_name_safe>/<file_name>[.png],
 * by_date/shifted/..., charts/Combo-<date>.png, live/spectrogram.png
 * Sets the has_* flags on the matching detection row.
 */
ingest.put('/media/*', async (c) => {
  const key = decodeURIComponent(c.req.path.replace(/^\/ingest\/media\//, ''));
  if (!safeKeySegment(key) || !/^(by_date|charts|live|custom)\//.test(key)) return c.json({ error: 'bad key' }, 400);
  const station = stationOf(null, c);
  const ct = c.req.header('content-type') || guessType(key);
  const len = Number(c.req.header('content-length') || 0);
  if (len > 50 * 1024 * 1024) return c.json({ error: 'file too large' }, 413);
  await c.env.MEDIA.put(key, c.req.raw.body, { httpMetadata: { contentType: ct }, customMetadata: { station } });

  let flag: string | null = null;
  let fileName = key.split('/').pop() ?? '';
  if (key.startsWith('by_date/shifted/')) flag = 'has_shifted';
  else if (key.startsWith('by_date/')) {
    if (fileName.endsWith('.png')) { flag = 'has_png'; fileName = fileName.slice(0, -4); } else flag = 'has_audio';
  }
  if (flag) {
    await c.env.DB.prepare(`UPDATE detections SET ${flag} = 1 WHERE station_id = ? AND file_name = ?`).bind(station, fileName).run();
  } else if (key.startsWith('charts/Combo-')) {
    const date = fileName.replace(/^Combo-/, '').replace(/\.png$/, '');
    await c.env.DB.prepare('INSERT INTO daily_charts (station_id, date, media_key, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(station_id, date) DO UPDATE SET updated_at = excluded.updated_at')
      .bind(station, date, key, nowIso()).run();
  }
  return c.json({ ok: true, key, flag });
});

/** POST /ingest/status  station heartbeat and config snapshot. */
ingest.post('/status', async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const station = stationOf(b as { station?: string }, c);
  const cfg = (b.config && typeof b.config === 'object') ? (b.config as Record<string, unknown>) : {};
  await c.env.DB.prepare(
    `INSERT INTO stations (id, name, timezone, lat, lon, last_seen_at, analyzing_now, pi_version, agent_version, disk_used_pct, backlog_files, config_json)
     VALUES (?1, COALESCE(?2, 'BirdNET-Pi'), COALESCE(?3, 'UTC'), ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
     ON CONFLICT(id) DO UPDATE SET name = COALESCE(?2, name), timezone = COALESCE(?3, timezone), lat = COALESCE(?4, lat), lon = COALESCE(?5, lon),
       last_seen_at = ?6, analyzing_now = ?7, pi_version = COALESCE(?8, pi_version), agent_version = COALESCE(?9, agent_version),
       disk_used_pct = ?10, backlog_files = ?11, config_json = CASE WHEN ?12 = '{}' THEN config_json ELSE ?12 END`,
  )
    .bind(
      station, (b.name as string) ?? null, (b.timezone as string) ?? null, b.lat ?? null, b.lon ?? null, nowIso(),
      (b.analyzing_now as string) ?? null, (b.pi_version as string) ?? null, (b.agent_version as string) ?? null,
      b.disk_used_pct ?? null, b.backlog_files ?? null, JSON.stringify(cfg),
    )
    .run();
  // The station timezone feeds "today" everywhere, so default the site name too.
  return c.json({ ok: true });
});

/** POST /ingest/live  the StreamData *.wav.json sidecar for the live spectrogram overlay. */
ingest.post('/live', async (c) => {
  const b = (await c.req.json().catch(() => null)) as { station?: string; file_name: string; timestamp: string; delay: number; detections: unknown[] } | null;
  if (!b?.file_name || !b.timestamp) return c.json({ error: 'file_name and timestamp required' }, 400);
  const station = stationOf(b, c);
  await c.env.DB.prepare(
    `INSERT INTO live_analysis (station_id, file_name, timestamp, delay, detections, pushed_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(station_id) DO UPDATE SET file_name = excluded.file_name, timestamp = excluded.timestamp, delay = excluded.delay, detections = excluded.detections, pushed_at = excluded.pushed_at`,
  ).bind(station, b.file_name, b.timestamp, Number(b.delay ?? 15), JSON.stringify(b.detections ?? []), nowIso()).run();
  return c.json({ ok: true });
});

/** POST /ingest/labels  { station?, labels: ["Sci name_Common name", ...] | [{sci_name, com_name, com_en_name?}] } */
ingest.post('/labels', async (c) => {
  const b = (await c.req.json().catch(() => null)) as { station?: string; labels?: (string | { sci_name: string; com_name: string; com_en_name?: string })[] } | null;
  if (!b?.labels) return c.json({ error: 'labels[] required' }, 400);
  const station = stationOf(b, c);
  const rows = b.labels
    .map((l) => (typeof l === 'string' ? { sci_name: l.split('_')[0], com_name: l.split('_').slice(1).join('_'), com_en_name: undefined } : l))
    .filter((l) => l.sci_name && l.com_name);
  await c.env.DB.prepare('DELETE FROM labels WHERE station_id = ?').bind(station).run();
  const stmt = c.env.DB.prepare('INSERT OR REPLACE INTO labels (station_id, sci_name, com_name, com_en_name) VALUES (?, ?, ?, ?)');
  const batch = rows.map((l) => stmt.bind(station, l.sci_name, l.com_name, l.com_en_name ?? null));
  for (let i = 0; i < batch.length; i += 100) await c.env.DB.batch(batch.slice(i, i + 100));
  return c.json({ ok: true, count: rows.length });
});

/**
 * POST /ingest/lists  { station?, include: [...], exclude: [...], whitelist: [...], confirmed: [...] }
 * Entries are "Sci name_Common name" lines (or bare sci names for confirmed).
 * Used once at install to seed the cloud from the Pi's text files. After that
 * the cloud is authoritative and the Pi receives sync_lists commands.
 */
ingest.post('/lists', async (c) => {
  const b = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return c.json({ error: 'json body required' }, 400);
  const station = stationOf(b as { station?: string }, c);
  const stmts: D1PreparedStatement[] = [];
  for (const list of ['include', 'exclude', 'whitelist', 'confirmed']) {
    const arr = b[list];
    if (!Array.isArray(arr)) continue;
    stmts.push(c.env.DB.prepare('DELETE FROM species_lists WHERE station_id = ? AND list = ?').bind(station, list));
    for (const line of arr as string[]) {
      const [sci, ...rest] = String(line).split('_');
      if (!sci.trim()) continue;
      stmts.push(c.env.DB.prepare('INSERT OR REPLACE INTO species_lists (station_id, list, sci_name, com_name) VALUES (?, ?, ?, ?)').bind(station, list, sci.trim(), rest.join('_')));
    }
  }
  for (let i = 0; i < stmts.length; i += 100) await c.env.DB.batch(stmts.slice(i, i + 100));
  return c.json({ ok: true });
});

/** POST /ingest/purged  { station?, file_names: [...] }  the Pi deleted these local files (disk purge). Rows stay. */
ingest.post('/purged', async (c) => {
  const b = (await c.req.json().catch(() => null)) as { station?: string; file_names?: string[] } | null;
  if (!b?.file_names) return c.json({ error: 'file_names[] required' }, 400);
  const station = stationOf(b, c);
  const stmt = c.env.DB.prepare('UPDATE detections SET on_pi = 0 WHERE station_id = ? AND file_name = ?');
  const batch = b.file_names.map((f) => stmt.bind(station, f));
  for (let i = 0; i < batch.length; i += 100) await c.env.DB.batch(batch.slice(i, i + 100));
  return c.json({ ok: true, count: b.file_names.length });
});

/**
 * GET /ingest/commands?station=&max=10
 * Returns pending commands and marks them taken. The agent should ack each
 * with POST /ingest/commands/:id.
 */
ingest.get('/commands', async (c) => {
  const station = stationOf(null, c);
  const max = Math.min(Number(c.req.query('max') ?? 10), 50);
  const { results } = await c.env.DB.prepare('SELECT id, kind, payload, created_at FROM commands WHERE station_id = ? AND status = ? ORDER BY id LIMIT ?')
    .bind(station, 'pending', max).all<{ id: number; kind: string; payload: string; created_at: string }>();
  if (results.length) {
    await c.env.DB.batch(results.map((r) => c.env.DB.prepare('UPDATE commands SET status = ?, taken_at = ? WHERE id = ?').bind('taken', nowIso(), r.id)));
  }
  await c.env.DB.prepare('UPDATE stations SET last_seen_at = ? WHERE id = ?').bind(nowIso(), station).run();
  return c.json({ commands: results.map((r) => ({ ...r, payload: JSON.parse(r.payload) })) });
});

/** POST /ingest/commands/:id  { status: "done"|"failed", result?: any } */
ingest.post('/commands/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const b = (await c.req.json().catch(() => ({}))) as { status?: string; result?: unknown; station?: string };
  const status = b.status === 'done' ? 'done' : 'failed';
  const station = stationOf(b, c);
  const cmd = await c.env.DB.prepare('SELECT kind, payload FROM commands WHERE id = ? AND station_id = ?').bind(id, station).first<{ kind: string; payload: string }>();
  if (!cmd) return c.json({ error: 'not found' }, 404);
  await c.env.DB.prepare('UPDATE commands SET status = ?, result = ?, finished_at = ? WHERE id = ?').bind(status, JSON.stringify(b.result ?? null), nowIso(), id).run();
  // Apply side effects that only make sense once the Pi has confirmed.
  if (status === 'done') await applyCommandResult(c.env, station, cmd.kind, JSON.parse(cmd.payload), b.result);
  return c.json({ ok: true });
});

async function applyCommandResult(env: AppEnv['Bindings'], station: string, kind: string, payload: Record<string, unknown>, result: unknown) {
  const db = env.DB;
  switch (kind) {
    case 'delete_file': {
      const f = payload.file_name as string;
      const row = await db.prepare('SELECT media_key FROM detections WHERE station_id = ? AND file_name = ?').bind(station, f).first<{ media_key: string }>();
      if (row) await env.MEDIA.delete([row.media_key, row.media_key + '.png', row.media_key.replace('by_date/', 'by_date/shifted/')]);
      await db.prepare('DELETE FROM detections WHERE station_id = ? AND file_name = ?').bind(station, f).run();
      break;
    }
    case 'delete_species': {
      const sci = payload.sci_name as string;
      const { results } = await db.prepare('SELECT media_key FROM detections WHERE station_id = ? AND sci_name = ?').bind(station, sci).all<{ media_key: string }>();
      const keys = results.flatMap((r) => [r.media_key, r.media_key + '.png', r.media_key.replace('by_date/', 'by_date/shifted/')]);
      for (let i = 0; i < keys.length; i += 1000) await env.MEDIA.delete(keys.slice(i, i + 1000));
      await db.batch([
        db.prepare('DELETE FROM detections WHERE station_id = ? AND sci_name = ?').bind(station, sci),
        db.prepare('DELETE FROM species_lists WHERE station_id = ? AND list = ? AND sci_name = ?').bind(station, 'confirmed', sci),
      ]);
      break;
    }
    case 'reidentify': {
      // The Pi renamed the files and updated its DB; it reports the new name.
      const r = (result ?? {}) as { new_file_name?: string };
      const oldName = payload.file_name as string;
      const newSci = payload.sci_name as string;
      const newCom = payload.com_name as string;
      const row = await db.prepare('SELECT date, media_key FROM detections WHERE station_id = ? AND file_name = ?').bind(station, oldName).first<{ date: string; media_key: string }>();
      if (!row) break;
      const newName = r.new_file_name ?? oldName.replace(/^[^-]+(?=-\d{1,3}-\d{4}-\d{2}-\d{2}-birdnet-)/, comNameSafe(newCom));
      const newKey = mediaKey(row.date, newCom, newName);
      // Move media in R2 (copy then delete); the agent re-uploads if this fails.
      for (const suffix of ['', '.png']) {
        const obj = await env.MEDIA.get(row.media_key + suffix);
        if (obj) {
          await env.MEDIA.put(newKey + suffix, obj.body, { httpMetadata: obj.httpMetadata });
          await env.MEDIA.delete(row.media_key + suffix);
        }
      }
      await db.prepare(
        'UPDATE detections SET sci_name = ?, com_name = ?, com_name_safe = ?, confidence = 0, file_name = ?, media_key = ?, has_shifted = 0 WHERE station_id = ? AND file_name = ?',
      ).bind(newSci, newCom, comNameSafe(newCom), newName, newKey, station, oldName).run();
      break;
    }
    case 'unshift': {
      const f = payload.file_name as string;
      const row = await db.prepare('SELECT media_key FROM detections WHERE station_id = ? AND file_name = ?').bind(station, f).first<{ media_key: string }>();
      if (row) await env.MEDIA.delete(row.media_key.replace('by_date/', 'by_date/shifted/'));
      await db.prepare('UPDATE detections SET has_shifted = 0 WHERE station_id = ? AND file_name = ?').bind(station, f).run();
      break;
    }
    // lock / unlock / shift / sync_lists / restart_service / run need nothing further:
    // lock state was already written to D1 when the command was created, and
    // the shifted file arrives through PUT /ingest/media which sets has_shifted.
  }
}

function guessType(key: string): string {
  if (key.endsWith('.png')) return 'image/png';
  if (key.endsWith('.mp3')) return 'audio/mpeg';
  if (key.endsWith('.wav')) return 'audio/wav';
  if (key.endsWith('.flac')) return 'audio/flac';
  if (key.endsWith('.ogg')) return 'audio/ogg';
  if (key.endsWith('.jpg') || key.endsWith('.jpeg')) return 'image/jpeg';
  return 'application/octet-stream';
}

export default ingest;
