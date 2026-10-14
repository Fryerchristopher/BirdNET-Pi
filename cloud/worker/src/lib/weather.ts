/**
 * Optional weather integration. Points at a Dorrington Weather style API
 * (settings.weather_api_url, e.g. https://weather.dorringtonbirds.com):
 *   GET /api/current.json  -> { current: { ts, metrics: { temp_c, wind_mph, gust_mph, rain_in_today, rain_rate_in_hr, ... } } }
 *   GET /api/series.json?metric=<id>&range=7d -> { points: [[ts, value], ...] }
 * Everything here degrades to null when the API is unset or unreachable.
 */

export interface Conditions {
  temp_f: number | null;
  temp_c: number | null;
  wind_mph: number | null;
  wind_text: string;      // "calm", "light breeze", "breeze 6 mph", "wind 18 mph"
  rain_today_in: number | null;
  rain_text: string;      // "no rain", "0.12 in of rain"
  raining: boolean;
  ts: number | null;
  stale: boolean;
  summary: string;        // "52°F, calm, no rain"
}

function windText(mph: number | null): string {
  if (mph == null) return 'wind unknown';
  if (mph < 1) return 'calm';
  if (mph < 4) return 'light breeze';
  if (mph < 13) return `breeze ${Math.round(mph)} mph`;
  return `wind ${Math.round(mph)} mph`;
}

function build(tempC: number | null, wind: number | null, rainToday: number | null, rainRate: number | null, ts: number | null, stale: boolean): Conditions {
  const tempF = tempC == null ? null : Math.round(tempC * 9 / 5 + 32);
  const raining = (rainRate ?? 0) > 0;
  const rainText = raining ? 'raining' : rainToday && rainToday > 0 ? `${rainToday.toFixed(2)} in of rain` : 'no rain';
  const w = windText(wind);
  return {
    temp_f: tempF, temp_c: tempC, wind_mph: wind, wind_text: w, rain_today_in: rainToday, rain_text: rainText, raining, ts, stale,
    summary: [tempF == null ? null : `${tempF}°F`, w, rainText].filter(Boolean).join(', '),
  };
}

async function getJson(url: string, ttl = 60): Promise<unknown | null> {
  try {
    const res = await fetch(url, { cf: { cacheTtl: ttl, cacheEverything: true } } as RequestInit);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function currentConditions(apiUrl: string): Promise<Conditions | null> {
  if (!apiUrl) return null;
  const j = (await getJson(`${apiUrl.replace(/\/$/, '')}/api/current.json`)) as { current?: { ts: number; isStale?: boolean; metrics: Record<string, number> } } | null;
  const m = j?.current?.metrics;
  if (!m) return null;
  return build(m.temp_c ?? null, m.wind_mph ?? null, m.rain_in_today ?? null, m.rain_rate_in_hr ?? null, j?.current?.ts ?? null, !!j?.current?.isStale);
}

/** Conditions nearest to a moment (unix seconds), from the 7-day series. */
export async function conditionsAt(apiUrl: string, ts: number): Promise<Conditions | null> {
  if (!apiUrl) return null;
  const ageDays = (Date.now() / 1000 - ts) / 86400;
  if (ageDays > 30 || ageDays < -1) return null;
  const range = ageDays <= 1 ? '24h' : ageDays <= 7 ? '7d' : '30d';
  const base = apiUrl.replace(/\/$/, '');
  const pick = async (metric: string) => {
    const j = (await getJson(`${base}/api/series.json?metric=${metric}&range=${range}`, 300)) as { points?: [number, number][] } | null;
    const pts = j?.points ?? [];
    let best: [number, number] | null = null;
    for (const p of pts) if (!best || Math.abs(p[0] - ts) < Math.abs(best[0] - ts)) best = p;
    return best && Math.abs(best[0] - ts) < 3 * 3600 ? best[1] : null;
  };
  const [t, w, rr] = await Promise.all([pick('temp_c'), pick('wind_mph'), pick('rain_rate_in_hr')]);
  if (t == null && w == null) return null;
  return build(t, w, null, rr, ts, false);
}
