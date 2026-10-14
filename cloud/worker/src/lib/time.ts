/**
 * Station-local time helpers. The Pi stores Date/Time in its own local zone,
 * so "today" and "last hour" must be computed in the station's timezone, not
 * the Worker's (which is always UTC).
 */

function parts(tz: string, d: Date): Record<string, string> {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(d)) out[p.type] = p.value;
  if (out.hour === '24') out.hour = '00';
  return out;
}

export function localDate(tz: string, d: Date = new Date()): string {
  const p = parts(tz, d);
  return `${p.year}-${p.month}-${p.day}`;
}

export function localTime(tz: string, d: Date = new Date()): string {
  const p = parts(tz, d);
  return `${p.hour}:${p.minute}:${p.second}`;
}

export function localDateTime(tz: string, d: Date = new Date()): string {
  return `${localDate(tz, d)} ${localTime(tz, d)}`;
}

/** YYYY-MM-DD plus/minus n days (calendar arithmetic, zone-free). */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

/** ISO-8601 week number for a YYYY-MM-DD date. */
export function isoWeek(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  return Math.ceil(((t.getTime() - yearStart) / 86400000 + 1) / 7);
}

/** 0 = Sunday ... 6 = Saturday */
export function dayOfWeek(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * The report week exactly as weekly_report.php computes it:
 * start = last Sunday - 7 days, end = last Sunday - 1 day, where "last Sunday"
 * is the most recent Sunday strictly before today. That is a Sunday..Saturday
 * window ending the day before the most recent Sunday.
 */
export function lastCompletedWeek(today: string): { start: string; end: string } {
  let dow = dayOfWeek(today);
  if (dow === 0) dow = 7;
  const lastSunday = addDays(today, -dow);
  return { start: addDays(lastSunday, -7), end: addDays(lastSunday, -1) };
}

export function isValidDate(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export function nowIso(): string {
  return new Date().toISOString();
}
