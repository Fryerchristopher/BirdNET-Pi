import type { Context, Next } from 'hono';
import type { AppEnv } from '../env';

function bearer(c: Context<AppEnv>): string | null {
  const h = c.req.header('authorization') ?? '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** The Pi agent. Bearer INGEST_TOKEN only. */
export async function requireIngest(c: Context<AppEnv>, next: Next) {
  const token = c.env.INGEST_TOKEN;
  if (!token) return c.json({ error: 'INGEST_TOKEN secret is not set on the Worker' }, 503);
  const got = bearer(c);
  if (!got || !timingSafeEqual(got, token)) return c.json({ error: 'unauthorized' }, 401);
  await next();
}

/**
 * Admin gate. Three modes, chosen with the ADMIN_AUTH var:
 *  - access: trust the Cf-Access-Jwt-Assertion header, validated against the
 *            team's public keys. Cloudflare Access must sit in front of the
 *            hostname for /admin* and /api/v1/admin/*.
 *  - token:  Bearer ADMIN_TOKEN (the admin UI stores it in sessionStorage).
 *  - open:   no auth. Local development only.
 */
export async function isAdmin(c: Context<AppEnv>): Promise<boolean> {
  const mode = c.env.ADMIN_AUTH ?? 'token';
  if (mode === 'open') return true;
  if (mode === 'token') {
    const token = c.env.ADMIN_TOKEN;
    const got = bearer(c);
    return !!token && !!got && timingSafeEqual(got, token);
  }
  if (mode === 'access') {
    const jwt = c.req.header('cf-access-jwt-assertion');
    if (!jwt) return false;
    return verifyAccessJwt(jwt, c.env.ACCESS_TEAM_DOMAIN, c.env.ACCESS_AUD);
  }
  return false;
}

export async function requireAdmin(c: Context<AppEnv>, next: Next) {
  if (!(await isAdmin(c))) return c.json({ error: 'admin authentication required' }, 401);
  c.set('admin', true);
  await next();
}

// ---------------------------------------------------------------------------
// Cloudflare Access JWT verification (RS256 against the team certs endpoint).
// ---------------------------------------------------------------------------
let certCache: { fetchedAt: number; keys: JsonWebKey[] } | null = null;

async function teamKeys(teamDomain: string): Promise<JsonWebKey[]> {
  if (certCache && Date.now() - certCache.fetchedAt < 3600_000) return certCache.keys;
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`Access certs fetch failed: ${res.status}`);
  const body = (await res.json()) as { keys: JsonWebKey[] };
  certCache = { fetchedAt: Date.now(), keys: body.keys };
  return body.keys;
}

function b64url(s: string): Uint8Array {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));
}

async function verifyAccessJwt(jwt: string, teamDomain: string, aud: string): Promise<boolean> {
  try {
    if (!teamDomain || !aud) return false;
    const [h, p, s] = jwt.split('.');
    if (!h || !p || !s) return false;
    const header = JSON.parse(new TextDecoder().decode(b64url(h))) as { kid: string; alg: string };
    const payload = JSON.parse(new TextDecoder().decode(b64url(p))) as { aud: string | string[]; exp: number; iss: string };
    if (header.alg !== 'RS256') return false;
    const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!auds.includes(aud)) return false;
    if (payload.exp * 1000 < Date.now()) return false;
    if (payload.iss !== `https://${teamDomain}`) return false;
    const keys = await teamKeys(teamDomain);
    const jwk = keys.find((k) => (k as { kid?: string }).kid === header.kid);
    if (!jwk) return false;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const data = new TextEncoder().encode(`${h}.${p}`);
    return crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(s), data);
  } catch {
    return false;
  }
}
