/**
 * All D1 queries live here so the API routes stay thin and the SQL is in one
 * place for anyone porting the PHP behaviour. Each function documents which
 * BirdNET-Pi page or helper it replaces.
 */
import { addDays, daysBetween, localDate, localTime, isoWeek, lastCompletedWeek } from './time';

export type Sort = 'alphabetical' | 'occurrences' | 'confidence' | 'date';

export interface DetectionRow {
  id: number;
  date: string;
  time: string;
  sci_name: string;
  com_name: string;
  confidence: number;
  file_name: string;
  com_name_safe: string;
  media_key: string;
  has_audio: number;
  has_png: number;
  has_shifted: number;
  locked: number;
  on_pi: number;
  lat?: number;
  lon?: number;
  cutoff?: number;
  week?: number;
  sens?: number;
  overlap?: number;
}

export interface SpeciesRow {
  sci_name: string;
  com_name: string;
  count: number;
  max_confidence: number;
  first_date: string;
  last_date: string;
  best_date: string;
  best_time: string;
  best_file_name: string;
  best_media_key: string;
  best_has_audio: number;
  best_has_png: number;
}

const DET_COLS =
  'id, date, time, sci_name, com_name, confidence, file_name, com_name_safe, media_key, has_audio, has_png, has_shifted, locked, on_pi, lat, lon, cutoff, week, sens, overlap';

export interface StationRow {
  id: string; name: string; timezone: string; lat: number | null; lon: number | null;
  last_seen_at: string | null; last_detection_at: string | null; analyzing_now: string | null;
  pi_version: string | null; agent_version: string | null; disk_used_pct: number | null; backlog_files: number | null;
  config_json: string;
}

export async function stationInfo(db: D1Database, station: string) {
  const row = await db.prepare('SELECT * FROM stations WHERE id = ?').bind(station).first<StationRow>();
  if (!row) return null;
  return { ...row, config: safeJson(row.config_json) as Record<string, unknown> };
}

export function safeJson(s: string | null | undefined): unknown {
  try {
    return s ? JSON.parse(s) : {};
  } catch {
    return {};
  }
}

export async function stationTz(db: D1Database, station: string): Promise<string> {
  const row = await db.prepare('SELECT timezone FROM stations WHERE id = ?').bind(station).first<{ timezone: string }>();
  return row?.timezone || 'UTC';
}

export async function getSettings(db: D1Database): Promise<Record<string, string>> {
  const { results } = await db.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>();
  const out: Record<string, string> = {};
  for (const r of results) out[r.key] = r.value;
  return out;
}

export async function setSettings(db: D1Database, values: Record<string, string>) {
  const stmts = Object.entries(values).map(([k, v]) =>
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(k, String(v)),
  );
  if (stmts.length) await db.batch(stmts);
}

/** overview.php / todays_detections.php stats table (get_summary). */
export async function summary(db: D1Database, station: string, tz: string) {
  const today = localDate(tz);
  const now = localTime(tz);
  const hourAgo = localTime(tz, new Date(Date.now() - 3600_000));
  // When the hour window crosses midnight the PHP simply compares TIME >= t-1h
  // within today's rows, which under-counts; we do the same for fidelity but
  // also handle the wrap correctly.
  const yesterday = addDays(today, -1);
  const hourStmt = hourAgo <= now
    ? db.prepare('SELECT COUNT(*) AS n FROM detections WHERE station_id = ? AND date = ? AND time >= ?').bind(station, today, hourAgo)
    : db.prepare('SELECT COUNT(*) AS n FROM detections WHERE station_id = ? AND (date = ? OR (date = ? AND time >= ?))').bind(station, today, yesterday, hourAgo);
  const [total, todayC, hour, spToday, spTotal] = await db.batch([
    db.prepare('SELECT COUNT(*) AS n FROM detections WHERE station_id = ?1').bind(station),
    db.prepare('SELECT COUNT(*) AS n FROM detections WHERE station_id = ?1 AND date = ?2').bind(station, today),
    hourStmt,
    db.prepare('SELECT COUNT(DISTINCT sci_name) AS n FROM detections WHERE station_id = ?1 AND date = ?2').bind(station, today),
    db.prepare('SELECT COUNT(DISTINCT sci_name) AS n FROM detections WHERE station_id = ?1').bind(station),
  ]);
  const n = (r: D1Result) => Number((r.results[0] as { n: number })?.n ?? 0);
  return {
    date: today,
    total: n(total),
    today: n(todayC),
    last_hour: n(hour),
    species_today: n(spToday),
    species_total: n(spTotal),
  };
}

function orderFor(sort: Sort, dated: boolean): string {
  switch (sort) {
    case 'occurrences':
      return 'd.count DESC, b.com_name ASC';
    case 'confidence':
      return 'd.max_confidence DESC, b.com_name ASC';
    case 'date':
      return dated ? 'd.last_time DESC' : 'd.last_date DESC, d.last_time DESC';
    default:
      return 'b.com_name COLLATE NOCASE ASC';
  }
}

/**
 * fetch_species_array(): one row per species with count, max confidence and
 * the best recording (the row holding MAX(Confidence)). The PHP relied on
 * SQLite's bare-column rule; here the best row is explicit.
 */
export async function speciesSummary(db: D1Database, station: string, sort: Sort, date?: string): Promise<SpeciesRow[]> {
  const where = date ? 'station_id = ?1 AND date = ?2' : 'station_id = ?1';
  const binds = date ? [station, date] : [station];
  const sql = `
    WITH agg AS (
      SELECT sci_name, COUNT(*) AS count, MAX(confidence) AS max_confidence,
             MIN(date) AS first_date, MAX(date) AS last_date,
             MAX(date || ' ' || time) AS last_time
      FROM detections WHERE ${where} GROUP BY sci_name
    ),
    best AS (
      SELECT sci_name, com_name, date, time, file_name, media_key, has_audio, has_png,
             ROW_NUMBER() OVER (PARTITION BY sci_name ORDER BY confidence DESC, date DESC, time DESC) AS rn
      FROM detections WHERE ${where}
    )
    SELECT d.sci_name, b.com_name, d.count, d.max_confidence, d.first_date, d.last_date,
           b.date AS best_date, b.time AS best_time, b.file_name AS best_file_name,
           b.media_key AS best_media_key, b.has_audio AS best_has_audio, b.has_png AS best_has_png
    FROM agg d JOIN best b ON b.sci_name = d.sci_name AND b.rn = 1
    ORDER BY ${orderFor(sort, !!date)}`;
  const { results } = await db.prepare(sql).bind(...binds).all<SpeciesRow>();
  return results;
}

/** fetch_best_detection(): best recording for one species. */
export async function bestDetection(db: D1Database, station: string, sciName: string) {
  const row = await db
    .prepare(
      `SELECT ${DET_COLS}, (SELECT COUNT(*) FROM detections WHERE station_id = ?1 AND sci_name = ?2) AS count
       FROM detections WHERE station_id = ?1 AND sci_name = ?2
       ORDER BY confidence DESC, date DESC, time DESC LIMIT 1`,
    )
    .bind(station, sciName)
    .first<DetectionRow & { count: number }>();
  return row ?? null;
}

export interface ListOpts {
  date?: string;
  from?: string;
  to?: string;
  sci?: string;
  com?: string;
  q?: string;
  sort?: 'date' | 'confidence';
  limit?: number;
  offset?: number;
  onlyLocked?: boolean;
  onlyAvailable?: boolean;
}

/** todays_detections.php / play.php / fetch_all_detections(). */
export async function listDetections(db: D1Database, station: string, o: ListOpts) {
  const where: string[] = ['station_id = ?'];
  const binds: unknown[] = [station];
  if (o.date) { where.push('date = ?'); binds.push(o.date); }
  if (o.from) { where.push('date >= ?'); binds.push(o.from); }
  if (o.to) { where.push('date <= ?'); binds.push(o.to); }
  if (o.sci) { where.push('sci_name = ?'); binds.push(o.sci); }
  if (o.com) { where.push('com_name = ?'); binds.push(o.com); }
  if (o.onlyLocked) where.push('locked = 1');
  if (o.onlyAvailable) where.push('has_audio = 1');
  if (o.q) {
    // Same semantics as todays_detections.php: a leading "not" negates.
    let term = o.q.trim();
    let neg = false;
    if (/^not\s+/i.test(term)) { neg = true; term = term.replace(/^not\s+/i, ''); }
    const like = `%${term}%`;
    const op = neg ? 'NOT LIKE' : 'LIKE';
    const join = neg ? 'AND' : 'OR';
    where.push(`(com_name ${op} ? ${join} sci_name ${op} ? ${join} CAST(confidence AS TEXT) ${op} ? ${join} file_name ${op} ? ${join} time ${op} ?)`);
    binds.push(like, like, like, like, like);
  }
  const order = o.sort === 'confidence' ? 'confidence DESC, date DESC, time DESC' : 'date DESC, time DESC';
  const limit = Math.min(Math.max(o.limit ?? 40, 1), 500);
  const offset = Math.max(o.offset ?? 0, 0);
  const sql = `SELECT ${DET_COLS} FROM detections WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ? OFFSET ?`;
  const { results } = await db.prepare(sql).bind(...binds, limit, offset).all<DetectionRow>();
  const total = await db
    .prepare(`SELECT COUNT(*) AS n FROM detections WHERE ${where.join(' AND ')}`)
    .bind(...binds)
    .first<{ n: number }>();
  return { items: results, total: total?.n ?? 0, limit, offset };
}

export async function detectionByFile(db: D1Database, station: string, fileName: string) {
  return db.prepare(`SELECT ${DET_COLS} FROM detections WHERE station_id = ? AND file_name = ?`).bind(station, fileName).first<DetectionRow>();
}

/** overview.php "Most Recent Detection": newest row that has a spectrogram. */
export async function mostRecent(db: D1Database, station: string, requirePng = true) {
  const cond = requirePng ? 'AND has_png = 1' : '';
  return db
    .prepare(`SELECT ${DET_COLS} FROM detections WHERE station_id = ? ${cond} ORDER BY date DESC, time DESC LIMIT 1`)
    .bind(station)
    .first<DetectionRow>();
}

/** overview.php new / rare species blocks. */
export async function newAndRare(db: D1Database, station: string, today: string, rareDays: number) {
  const sql = `
    WITH today_best AS (
      SELECT sci_name, com_name, date, time, confidence, file_name, media_key, has_audio, has_png,
             ROW_NUMBER() OVER (PARTITION BY sci_name ORDER BY confidence DESC) AS rn,
             COUNT(*) OVER (PARTITION BY sci_name) AS occurrences,
             MIN(time) OVER (PARTITION BY sci_name) AS first_time
      FROM detections WHERE station_id = ?1 AND date = ?2
    )
    SELECT t.sci_name, t.com_name, t.time AS best_time, t.first_time, t.confidence AS max_confidence,
           t.file_name, t.media_key, t.has_audio, t.has_png, t.occurrences,
           (SELECT MAX(date) FROM detections p WHERE p.station_id = ?1 AND p.sci_name = t.sci_name AND p.date < ?2) AS last_seen_date
    FROM today_best t WHERE t.rn = 1 ORDER BY t.com_name`;
  const { results } = await db.prepare(sql).bind(station, today).all<{
    sci_name: string; com_name: string; best_time: string; first_time: string; max_confidence: number;
    file_name: string; media_key: string; has_audio: number; has_png: number; occurrences: number; last_seen_date: string | null;
  }>();
  const newSpecies = results.filter((r) => r.last_seen_date === null);
  const rare = results
    .filter((r) => r.last_seen_date !== null && daysBetween(r.last_seen_date, today) > rareDays)
    .map((r) => ({ ...r, days_ago: daysBetween(r.last_seen_date as string, today) }));
  return { new_species: newSpecies, rare_species: rare };
}

/** generateMiniGraph data: detections per day for one species over N days, zero-filled. */
export async function speciesHistory(db: D1Database, station: string, sciName: string, today: string, days: number) {
  const from = addDays(today, -days);
  const { results } = await db
    .prepare('SELECT date, COUNT(*) AS n FROM detections WHERE station_id = ? AND sci_name = ? AND date BETWEEN ? AND ? GROUP BY date')
    .bind(station, sciName, from, today)
    .all<{ date: string; n: number }>();
  const map = new Map(results.map((r) => [r.date, r.n]));
  const out: { date: string; count: number }[] = [];
  for (let i = days; i >= 0; i--) {
    const d = addDays(today, -i);
    out.push({ date: d, count: map.get(d) ?? 0 });
  }
  return out;
}

/** history.php + daily_plot.py: species x hour matrix for one day. */
export async function dailyMatrix(db: D1Database, station: string, date: string) {
  const { results } = await db
    .prepare(
      `SELECT sci_name, com_name, CAST(substr(time, 1, 2) AS INTEGER) AS hour, COUNT(*) AS n, MAX(confidence) AS max_conf
       FROM detections WHERE station_id = ? AND date = ? GROUP BY sci_name, hour`,
    )
    .bind(station, date)
    .all<{ sci_name: string; com_name: string; hour: number; n: number; max_conf: number }>();
  const species = new Map<string, { sci_name: string; com_name: string; total: number; max_confidence: number; hours: number[] }>();
  for (const r of results) {
    let s = species.get(r.sci_name);
    if (!s) {
      s = { sci_name: r.sci_name, com_name: r.com_name, total: 0, max_confidence: 0, hours: new Array(24).fill(0) };
      species.set(r.sci_name, s);
    }
    s.hours[r.hour] = r.n;
    s.total += r.n;
    s.max_confidence = Math.max(s.max_confidence, r.max_conf);
  }
  const rows = [...species.values()].sort((a, b) => b.total - a.total);
  return { date, total: rows.reduce((a, r) => a + r.total, 0), species: rows };
}

/** play.php?bydate: dates that have detections. */
export async function dates(db: D1Database, station: string) {
  const { results } = await db
    .prepare('SELECT date, COUNT(*) AS count, COUNT(DISTINCT sci_name) AS species, SUM(has_audio) AS with_audio FROM detections WHERE station_id = ? GROUP BY date ORDER BY date DESC')
    .bind(station)
    .all<{ date: string; count: number; species: number; with_audio: number }>();
  return results;
}

/** weekly_report.php */
export async function weeklyReport(db: D1Database, station: string, today: string, weekOverride?: { start: string; end: string }) {
  const { start, end } = weekOverride ?? lastCompletedWeek(today);
  const pStart = addDays(start, -7);
  const pEnd = addDays(end, -7);
  const [cur, prev, totals, firsts] = await db.batch([
    db.prepare('SELECT sci_name, com_name, COUNT(*) AS n FROM detections WHERE station_id = ?1 AND date BETWEEN ?2 AND ?3 GROUP BY sci_name ORDER BY n DESC').bind(station, start, end),
    db.prepare('SELECT sci_name, COUNT(*) AS n FROM detections WHERE station_id = ?1 AND date BETWEEN ?2 AND ?3 GROUP BY sci_name').bind(station, pStart, pEnd),
    db.prepare(
      `SELECT
        (SELECT COUNT(*) FROM detections WHERE station_id = ?1 AND date BETWEEN ?2 AND ?3) AS total,
        (SELECT COUNT(*) FROM detections WHERE station_id = ?1 AND date BETWEEN ?4 AND ?5) AS prior_total,
        (SELECT COUNT(DISTINCT sci_name) FROM detections WHERE station_id = ?1 AND date BETWEEN ?2 AND ?3) AS species,
        (SELECT COUNT(DISTINCT sci_name) FROM detections WHERE station_id = ?1 AND date BETWEEN ?4 AND ?5) AS prior_species`,
    ).bind(station, start, end, pStart, pEnd),
    // species with no detections outside the week = first seen this week
    db.prepare(
      `SELECT sci_name FROM detections WHERE station_id = ?1 GROUP BY sci_name HAVING MIN(date) >= ?2 AND MAX(date) <= ?3`,
    ).bind(station, start, end),
  ]);
  const prevMap = new Map((prev.results as { sci_name: string; n: number }[]).map((r) => [r.sci_name, r.n]));
  const firstSet = new Set((firsts.results as { sci_name: string }[]).map((r) => r.sci_name));
  const pct = (count: number, prior: number) => {
    if (prior === 0) return count > 0 ? null : 0; // null renders as "new" / INF
    return Math.round(((count - prior) / prior) * 100);
  };
  const t = totals.results[0] as { total: number; prior_total: number; species: number; prior_species: number };
  const species = (cur.results as { sci_name: string; com_name: string; n: number }[]).map((r) => ({
    sci_name: r.sci_name,
    com_name: r.com_name,
    count: r.n,
    prior_count: prevMap.get(r.sci_name) ?? 0,
    change_pct: pct(r.n, prevMap.get(r.sci_name) ?? 0),
    first_seen: firstSet.has(r.sci_name),
  }));
  return {
    week: isoWeek(end),
    start,
    end,
    prior_start: pStart,
    prior_end: pEnd,
    total: t.total,
    prior_total: t.prior_total,
    total_change_pct: pct(t.total, t.prior_total),
    species_count: t.species,
    prior_species_count: t.prior_species,
    species_change_pct: pct(t.species, t.prior_species),
    top: species.slice(0, 10),
    first_seen: species.filter((s) => s.first_seen),
    all: species,
  };
}

/**
 * plotly_streamlit.py replacement. Everything the Species Stats page needs
 * for a date range, computed in SQL:
 *  - per-species totals (top N)
 *  - per-hour counts (all species, or one species)
 *  - per-date counts
 *  - optional 15-minute x date matrix for one species (DAILY heatmap)
 *  - confidence max / median for one species
 */
export async function rangeStats(db: D1Database, station: string, from: string, to: string, sci?: string, topN = 10) {
  const sp = sci ? 'AND sci_name = ?4' : '';
  const binds: unknown[] = [station, from, to];
  if (sci) binds.push(sci);
  const [species, hours, perDate] = await db.batch([
    db.prepare(`SELECT sci_name, com_name, COUNT(*) AS n FROM detections WHERE station_id = ?1 AND date BETWEEN ?2 AND ?3 GROUP BY sci_name ORDER BY n DESC`).bind(station, from, to),
    db.prepare(`SELECT CAST(substr(time,1,2) AS INTEGER) AS hour, COUNT(*) AS n FROM detections WHERE station_id = ?1 AND date BETWEEN ?2 AND ?3 ${sp} GROUP BY hour`).bind(...binds),
    db.prepare(`SELECT date, COUNT(*) AS n FROM detections WHERE station_id = ?1 AND date BETWEEN ?2 AND ?3 ${sp} GROUP BY date ORDER BY date`).bind(...binds),
  ]);
  const hourArr = new Array(24).fill(0);
  for (const r of hours.results as { hour: number; n: number }[]) hourArr[r.hour] = r.n;
  const out: Record<string, unknown> = {
    from,
    to,
    species: (species.results as unknown[]).slice(0, Math.max(topN, 1)),
    species_total: species.results.length,
    hours: hourArr,
    dates: perDate.results,
    total: (perDate.results as { n: number }[]).reduce((a, r) => a + r.n, 0),
  };
  if (sci) {
    const conf = await db
      .prepare('SELECT confidence FROM detections WHERE station_id = ? AND sci_name = ? AND date BETWEEN ? AND ? ORDER BY confidence')
      .bind(station, sci, from, to)
      .all<{ confidence: number }>();
    const c = conf.results.map((r) => r.confidence);
    out.confidence = c.length ? { max: c[c.length - 1], median: c[Math.floor(c.length / 2)], count: c.length } : null;
    const slots = await db
      .prepare(
        `SELECT date, (CAST(substr(time,1,2) AS INTEGER) * 4 + CAST(substr(time,4,2) AS INTEGER) / 15) AS slot, COUNT(*) AS n
         FROM detections WHERE station_id = ? AND sci_name = ? AND date BETWEEN ? AND ? GROUP BY date, slot`,
      )
      .bind(station, sci, from, to)
      .all<{ date: string; slot: number; n: number }>();
    out.quarter_hours = slots.results; // 96 slots per day; client builds the heatmap
    const recs = await db
      .prepare(`SELECT ${DET_COLS} FROM detections WHERE station_id = ? AND sci_name = ? AND date BETWEEN ? AND ? ORDER BY date DESC, time DESC LIMIT 200`)
      .bind(station, sci, from, to)
      .all<DetectionRow>();
    out.recordings = recs.results;
  }
  return out;
}

/** Species Management table. */
export async function speciesManagement(db: D1Database, station: string) {
  const { results } = await db
    .prepare(
      `SELECT sci_name, MAX(com_name) AS com_name, COUNT(*) AS count, MAX(confidence) AS max_confidence,
              MAX(date) AS last_seen, MIN(date) AS first_seen, SUM(has_audio) AS files_in_cloud, SUM(on_pi) AS files_on_pi, SUM(locked) AS locked
       FROM detections WHERE station_id = ? GROUP BY sci_name ORDER BY com_name COLLATE NOCASE`,
    )
    .bind(station)
    .all();
  const lists = await db.prepare('SELECT list, sci_name FROM species_lists WHERE station_id = ?').bind(station).all<{ list: string; sci_name: string }>();
  const byList: Record<string, Set<string>> = {};
  for (const l of lists.results) (byList[l.list] ??= new Set()).add(l.sci_name);
  return (results as Record<string, unknown>[]).map((r) => ({
    ...r,
    confirmed: byList.confirmed?.has(r.sci_name as string) ?? false,
    excluded: byList.exclude?.has(r.sci_name as string) ?? false,
    whitelisted: byList.whitelist?.has(r.sci_name as string) ?? false,
    included: byList.include?.has(r.sci_name as string) ?? false,
  }));
}

export async function enqueueCommand(db: D1Database, station: string, kind: string, payload: unknown) {
  const r = await db
    .prepare('INSERT INTO commands (station_id, kind, payload) VALUES (?, ?, ?) RETURNING id')
    .bind(station, kind, JSON.stringify(payload ?? {}))
    .first<{ id: number }>();
  return r?.id ?? null;
}

export async function listLists(db: D1Database, station: string) {
  const { results } = await db.prepare('SELECT list, sci_name, com_name FROM species_lists WHERE station_id = ? ORDER BY list, com_name').bind(station).all<{ list: string; sci_name: string; com_name: string }>();
  const out: Record<string, { sci_name: string; com_name: string }[]> = { include: [], exclude: [], whitelist: [], confirmed: [] };
  for (const r of results) (out[r.list] ??= []).push({ sci_name: r.sci_name, com_name: r.com_name });
  return out;
}
