/**
 * What the public API is allowed to say about where the station is.
 *
 * The database keeps the Pi's exact coordinates (sun times and the admin
 * pages use them). Public responses get them rounded to COORD_DECIMALS
 * places (default 2, about 1 km), so a public site does not pin the
 * station to a house. Rounding happens on the way out; nothing stored
 * changes, and raising COORD_DECIMALS brings the precision back.
 */
import type { MiddlewareHandler } from 'hono';
import type { AppEnv, Env } from '../env';

const COORD_KEYS = new Set(['lat', 'lon', 'latitude', 'longitude']);
/** Never public: the BirdWeather station ID is that station's upload token. */
const SECRET_KEYS = new Set(['BIRDWEATHER_ID']);

export function coordDecimals(env: Env): number {
  const n = Number(env.COORD_DECIMALS ?? 2);
  return Number.isInteger(n) && n >= 0 && n <= 6 ? n : 2;
}

export function roundCoord(v: unknown, decimals: number): unknown {
  if (typeof v !== 'number' || !Number.isFinite(v)) return v;
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}

/** Rounds every lat/lon and drops secret keys anywhere in a JSON response. */
export const publicJson: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  if (new URL(c.req.url).pathname.startsWith('/api/v1/admin')) return;
  if (!(c.res.headers.get('content-type') ?? '').includes('application/json')) return;
  const decimals = coordDecimals(c.env);
  const text = await c.res.clone().text();
  let body: unknown;
  try {
    body = JSON.parse(text, (k, v) => (SECRET_KEYS.has(k) ? undefined : COORD_KEYS.has(k) ? roundCoord(v, decimals) : v));
  } catch {
    return;
  }
  const headers = new Headers(c.res.headers);
  headers.delete('content-length');
  c.res = new Response(JSON.stringify(body), { status: c.res.status, headers });
};
