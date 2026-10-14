/**
 * Optional cloud-side notifications. The Pi's own Apprise setup keeps working
 * untouched; this exists for people who want notifications without keeping
 * Apprise on the Pi. One generic webhook (NOTIFY_WEBHOOK secret) receives a
 * JSON POST. Point it at an Apprise API server, a Discord/Slack webhook, or
 * anything that accepts JSON.
 *
 * Rules mirror utils/notifications.py:
 *   - notify_new_species: species seen 1..5 times in the last 7 days
 *   - notify_first_of_day: first detection of the species today
 *   - notify_each_detection: everything
 *   - min_seconds_between_per_species
 */
import type { Env } from '../env';
import { getSettings } from './db';
import { addDays } from './time';

interface Det { sci_name: string; com_name: string; date: string; time: string; confidence: number; file_name: string; }

export async function notifyNewDetections(env: Env, station: string, rows: Det[]) {
  if (!env.NOTIFY_WEBHOOK || rows.length === 0) return;
  const s = await getSettings(env.DB);
  const each = s.notify_each_detection === '1';
  const firstOfDay = s.notify_first_of_day === '1';
  const infrequent = s.notify_new_species === '1';
  if (!each && !firstOfDay && !infrequent) return;
  const minGap = Number(s.notify_min_seconds_per_species ?? 0);
  const exclude = new Set((s.notify_exclude_species ?? '').toLowerCase().split(',').map((x) => x.replace(/\s/g, '')).filter(Boolean));
  const only = new Set((s.notify_only_species ?? '').toLowerCase().split(',').map((x) => x.replace(/\s/g, '')).filter(Boolean));

  for (const d of rows) {
    const key = d.com_name.toLowerCase().replace(/\s/g, '');
    if (exclude.has(key)) continue;
    if (only.size && !only.has(key)) continue;
    const last = await env.DB.prepare('SELECT sent_at FROM notification_log WHERE station_id = ? AND sci_name = ? ORDER BY sent_at DESC LIMIT 1')
      .bind(station, d.sci_name).first<{ sent_at: string }>();
    if (last && minGap > 0 && Date.now() - Date.parse(last.sent_at) < minGap * 1000) continue;

    const counts = await env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM detections WHERE station_id = ?1 AND sci_name = ?2 AND date = ?3) AS today,
              (SELECT COUNT(*) FROM detections WHERE station_id = ?1 AND sci_name = ?2 AND date >= ?4) AS week`,
    ).bind(station, d.sci_name, d.date, addDays(d.date, -7)).first<{ today: number; week: number }>();
    const reasons: string[] = [];
    if (each) reasons.push('detection');
    if (firstOfDay && counts?.today === 1) reasons.push('first time today');
    if (infrequent && counts && counts.week >= 1 && counts.week <= 5) reasons.push(`only seen ${counts.week} times in last 7d`);
    if (!reasons.length) continue;

    const siteUrl = s.site_url ?? '';
    const payload = {
      type: 'detection',
      station,
      title: s.notify_title || 'New BirdNET-Pi Detection',
      body: `A ${d.com_name} (${d.sci_name}) was just detected with a confidence of ${Math.round(d.confidence * 100)}% (${reasons.join(', ')})`,
      sciname: d.sci_name,
      comname: d.com_name,
      confidence: d.confidence,
      confidencepct: Math.round(d.confidence * 100),
      date: d.date,
      time: d.time,
      reason: reasons.join(', '),
      listenurl: siteUrl ? `${siteUrl}/recordings?file=${encodeURIComponent(d.file_name)}` : '',
    };
    await postWebhook(env.NOTIFY_WEBHOOK, payload);
    await env.DB.prepare('INSERT INTO notification_log (station_id, sci_name, reason) VALUES (?, ?, ?)').bind(station, d.sci_name, reasons.join(', ')).run();
  }
}

export async function postWebhook(url: string, payload: unknown) {
  try {
    await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  } catch {
    /* best effort */
  }
}
