/**
 * Sunrise and sunset (NOAA solar calculator, accurate to about a minute).
 * Returns times formatted HH:MM in the station's time zone, plus fractions of
 * the local day (0..1) for placing lines on 24-hour charts.
 */
import { localDate } from './time';

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

function julianDay(y: number, m: number, d: number): number {
  if (m <= 2) { y -= 1; m += 12; }
  const a = Math.floor(y / 100);
  const b = 2 - a + Math.floor(a / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + b - 1524.5;
}

/** Minutes after UTC midnight of sunrise/sunset on the given UTC date, or null above the polar circles. */
function sunEventsUtc(date: string, lat: number, lon: number): { rise: number | null; set: number | null } {
  const [y, m, d] = date.split('-').map(Number);
  const jd = julianDay(y, m, d);
  const t = (jd - 2451545) / 36525;
  const L0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const M = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const C = Math.sin(rad(M)) * (1.914602 - t * (0.004817 + 0.000014 * t)) + Math.sin(rad(2 * M)) * (0.019993 - 0.000101 * t) + Math.sin(rad(3 * M)) * 0.000289;
  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * t;
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(rad(omega));
  const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(rad(omega));
  const decl = deg(Math.asin(Math.sin(rad(eps)) * Math.sin(rad(lambda))));
  const yv = Math.tan(rad(eps / 2)) ** 2;
  const eqTime = 4 * deg(yv * Math.sin(2 * rad(L0)) - 2 * e * Math.sin(rad(M)) + 4 * e * yv * Math.sin(rad(M)) * Math.cos(2 * rad(L0)) - 0.5 * yv * yv * Math.sin(4 * rad(L0)) - 1.25 * e * e * Math.sin(2 * rad(M)));
  const cosHa = (Math.cos(rad(90.833)) / (Math.cos(rad(lat)) * Math.cos(rad(decl)))) - Math.tan(rad(lat)) * Math.tan(rad(decl));
  if (cosHa > 1 || cosHa < -1) return { rise: null, set: null };
  const ha = deg(Math.acos(cosHa));
  const noon = 720 - 4 * lon - eqTime;
  return { rise: noon - 4 * ha, set: noon + 4 * ha };
}

export interface SunTimes {
  sunrise: string | null; // HH:MM local
  sunset: string | null;
  sunrise_frac: number | null; // fraction of local day
  sunset_frac: number | null;
  daylight_minutes: number | null;
}

function fmtLocal(date: string, minutesUtc: number, tz: string): { hhmm: string; frac: number } {
  const [y, m, d] = date.split('-').map(Number);
  const ms = Date.UTC(y, m - 1, d) + minutesUtc * 60000;
  const dt = new Date(ms);
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(dt);
  const hh = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24;
  const mm = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return { hhmm: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`, frac: (hh * 60 + mm) / 1440 };
}

export function sunTimes(date: string, lat: number | null | undefined, lon: number | null | undefined, tz: string): SunTimes {
  if (lat == null || lon == null || (lat === 0 && lon === 0)) return { sunrise: null, sunset: null, sunrise_frac: null, sunset_frac: null, daylight_minutes: null };
  // Solve on the UTC date that contains local noon, which keeps the event on the local day.
  const noonLocalUtcDate = localDate('UTC', new Date(Date.parse(`${date}T12:00:00Z`) - tzOffsetMinutes(tz, date) * 60000));
  const ev = sunEventsUtc(noonLocalUtcDate, lat, lon);
  if (ev.rise == null || ev.set == null) return { sunrise: null, sunset: null, sunrise_frac: null, sunset_frac: null, daylight_minutes: null };
  const r = fmtLocal(noonLocalUtcDate, ev.rise, tz);
  const s = fmtLocal(noonLocalUtcDate, ev.set, tz);
  return { sunrise: r.hhmm, sunset: s.hhmm, sunrise_frac: r.frac, sunset_frac: s.frac, daylight_minutes: Math.round(ev.set - ev.rise) };
}

/** Offset of tz from UTC in minutes on the given date (positive east). */
export function tzOffsetMinutes(tz: string, date: string): number {
  const probe = new Date(`${date}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(probe);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'));
  return Math.round((asUtc - probe.getTime()) / 60000);
}
