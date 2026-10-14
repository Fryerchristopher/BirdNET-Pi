/**
 * /media/<key>  Streams objects from R2 with Range support (so <audio> can
 * seek) and long cache headers. Keys mirror the Pi's By_Date layout:
 *   /media/by_date/<date>/<com_name_safe>/<file_name>        audio clip
 *   /media/by_date/<date>/<com_name_safe>/<file_name>.png    spectrogram
 *   /media/by_date/shifted/...                                pitch-shifted copy
 *   /media/charts/Combo-<date>.png                            daily chart from the Pi (optional)
 *   /media/live/spectrogram.png                               "currently analyzing" image
 */
import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { safeKeySegment } from '../lib/names';

const media = new Hono<AppEnv>();

media.get('/*', async (c) => {
  const key = decodeURIComponent(c.req.path.replace(/^\/media\//, ''));
  if (!safeKeySegment(key)) return c.text('bad key', 400);
  const range = c.req.header('range');
  const opts: R2GetOptions = {};
  if (range) {
    const m = range.match(/^bytes=(\d*)-(\d*)$/);
    if (m) {
      if (m[1] && m[2]) opts.range = { offset: Number(m[1]), length: Number(m[2]) - Number(m[1]) + 1 };
      else if (m[1]) opts.range = { offset: Number(m[1]) };
      else if (m[2]) opts.range = { suffix: Number(m[2]) };
    }
  }
  const obj = await c.env.MEDIA.get(key, opts);
  if (!obj) return c.text('not found', 404);
  const h = new Headers();
  obj.writeHttpMetadata(h);
  h.set('etag', obj.httpEtag);
  h.set('accept-ranges', 'bytes');
  const live = key.startsWith('live/');
  h.set('cache-control', live ? 'no-store' : 'public, max-age=31536000, immutable');
  if (obj.range && 'offset' in obj.range) {
    const offset = obj.range.offset ?? 0;
    const length = obj.range.length ?? obj.size - offset;
    h.set('content-range', `bytes ${offset}-${offset + length - 1}/${obj.size}`);
    h.set('content-length', String(length));
    return new Response(obj.body, { status: 206, headers: h });
  }
  h.set('content-length', String(obj.size));
  return new Response(obj.body, { status: 200, headers: h });
});

export default media;
