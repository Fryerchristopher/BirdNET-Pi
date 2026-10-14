/**
 * Species image lookup, ported from common.php's Wikipedia and Flickr classes.
 * Results are cached in D1 (species_images) for 15..25 days, like the Pi.
 */
import { wikiTitle } from './names';

export interface SpeciesImage {
  sci_name: string;
  provider: string;
  com_en_name: string;
  image_url: string;
  title: string;
  image_id: string;
  author_url: string;
  license_url: string;
  photos_url: string;
}

const UA = 'BirdNET-Pi-Cloud (+https://github.com/Nachtzuster/BirdNET-Pi)';

export async function getSpeciesImage(
  db: D1Database,
  provider: 'wikipedia' | 'flickr' | 'none',
  sciName: string,
  comEnName: string,
  flickrKey?: string,
  flickrUser?: string,
): Promise<SpeciesImage | null> {
  if (provider === 'none') return null;
  if (provider === 'flickr' && !flickrKey) provider = 'wikipedia';
  const cached = await db
    .prepare('SELECT * FROM species_images WHERE sci_name = ? AND provider = ?')
    .bind(sciName, provider)
    .first<SpeciesImage & { expires_at: string }>();
  if (cached && cached.expires_at > new Date().toISOString()) {
    if (provider === 'flickr') {
      const bl = await db.prepare('SELECT 1 FROM blacklisted_images WHERE image_id = ?').bind(cached.image_id).first();
      if (!bl) return cached;
    } else {
      return cached;
    }
  }
  let img: SpeciesImage | null = null;
  try {
    img = provider === 'flickr' ? await fetchFlickr(db, sciName, comEnName, flickrKey as string, flickrUser) : await fetchWikipedia(sciName);
  } catch {
    img = null;
  }
  if (!img) return cached ?? null; // serve stale rather than nothing
  const ttlDays = 15 + Math.floor(Math.random() * 11);
  const now = new Date();
  await db
    .prepare(
      `INSERT INTO species_images (sci_name, provider, com_en_name, image_url, title, image_id, author_url, license_url, photos_url, fetched_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(sci_name, provider) DO UPDATE SET com_en_name=excluded.com_en_name, image_url=excluded.image_url, title=excluded.title,
         image_id=excluded.image_id, author_url=excluded.author_url, license_url=excluded.license_url, photos_url=excluded.photos_url,
         fetched_at=excluded.fetched_at, expires_at=excluded.expires_at`,
    )
    .bind(
      img.sci_name, img.provider, img.com_en_name, img.image_url, img.title, img.image_id, img.author_url, img.license_url, img.photos_url,
      now.toISOString(), new Date(now.getTime() + ttlDays * 86400000).toISOString(),
    )
    .run();
  return img;
}

async function fetchWikipedia(sciName: string): Promise<SpeciesImage | null> {
  const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wikiTitle(sciName))}`, {
    headers: { 'user-agent': UA, accept: 'application/json' },
  });
  if (!res.ok) return null;
  const s = (await res.json()) as { title?: string; originalimage?: { source: string; width: number } };
  if (!s.originalimage?.source) return null;
  let imageUrl = s.originalimage.source.split('?')[0];
  const imageName = decodeURIComponent(imageUrl.split('/').pop() ?? '');
  const filePage = `https://en.wikipedia.org/wiki/File:${imageName}`;
  let authorUrl = filePage;
  let licenseUrl = filePage;
  try {
    const info = await fetch(
      `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent('File:' + imageName)}&prop=imageinfo&iiprop=extmetadata%7Csize&format=json`,
      { headers: { 'user-agent': UA } },
    );
    const j = (await info.json()) as { query?: { pages?: Record<string, { imageinfo?: { extmetadata?: Record<string, { value: string }> }[] }> } };
    const page = Object.values(j.query?.pages ?? {})[0];
    const meta = page?.imageinfo?.[0]?.extmetadata ?? {};
    const artist = meta.Artist?.value ?? '';
    const href = artist.match(/href="(http[^"]+)"/);
    if (href) authorUrl = href[1];
    if (meta.LicenseUrl?.value) licenseUrl = meta.LicenseUrl.value;
  } catch {
    /* attribution falls back to the file page */
  }
  if (s.originalimage.width > 1280) {
    imageUrl = imageUrl.replace('/commons/', '/commons/thumb/') + `/1280px-${encodeURIComponent(imageName)}`;
  }
  return {
    sci_name: sciName,
    provider: 'wikipedia',
    com_en_name: '',
    image_url: imageUrl,
    title: s.title ?? sciName,
    image_id: sciName,
    author_url: authorUrl,
    license_url: licenseUrl,
    photos_url: filePage,
  };
}

interface FlickrPhoto { id: string; owner: string; secret: string; server: string; farm: number; title: string; }

async function fetchFlickr(db: D1Database, sciName: string, comEnName: string, key: string, userEmail?: string): Promise<SpeciesImage | null> {
  const text = comEnName || sciName;
  let userParam = '';
  if (userEmail) {
    const u = await fetch(`https://www.flickr.com/services/rest/?method=flickr.people.findByEmail&api_key=${key}&find_email=${encodeURIComponent(userEmail)}&format=json&nojsoncallback=1`);
    const uj = (await u.json()) as { user?: { nsid: string } };
    if (uj.user?.nsid) userParam = `&user_id=${uj.user.nsid}`;
  }
  const q = userEmail ? encodeURIComponent(text) : encodeURIComponent(text) + '%20bird';
  const res = await fetch(
    `https://www.flickr.com/services/rest/?method=flickr.photos.search&api_key=${key}&text=${q}&sort=relevance&license=2,3,4,5,6,9&orientation=square,portrait&per_page=5&media=photos&format=json&nojsoncallback=1${userParam}`,
  );
  const j = (await res.json()) as { photos?: { photo: FlickrPhoto[] } };
  const bl = await db.prepare('SELECT image_id FROM blacklisted_images').all<{ image_id: string }>();
  const blacklisted = new Set(bl.results.map((r) => r.image_id));
  blacklisted.add('4892923285'); // the PHP skips this one too
  const photo = (j.photos?.photo ?? []).find((p) => !blacklisted.has(p.id));
  if (!photo) return null;
  let licenseUrl = '';
  try {
    const info = await fetch(`https://www.flickr.com/services/rest/?method=flickr.photos.getInfo&api_key=${key}&photo_id=${photo.id}&format=json&nojsoncallback=1`);
    const ij = (await info.json()) as { photo?: { license: string } };
    const lic = await fetch(`https://www.flickr.com/services/rest/?method=flickr.photos.licenses.getInfo&api_key=${key}&format=json&nojsoncallback=1`);
    const lj = (await lic.json()) as { licenses?: { license: { id: string; url: string }[] } };
    licenseUrl = lj.licenses?.license.find((l) => String(l.id) === String(ij.photo?.license))?.url ?? '';
  } catch {
    /* optional */
  }
  const authorUrl = `https://flickr.com/people/${photo.owner}`;
  return {
    sci_name: sciName,
    provider: 'flickr',
    com_en_name: comEnName,
    image_url: `https://farm${photo.farm}.static.flickr.com/${photo.server}/${photo.id}_${photo.secret}.jpg`,
    title: photo.title,
    image_id: photo.id,
    author_url: authorUrl,
    license_url: licenseUrl,
    photos_url: `https://flickr.com/photos/${photo.owner}/${photo.id}`,
  };
}

/** stats.php gallery: up to 15 Flickr photos for a species. */
export async function flickrGallery(key: string, comEnName: string) {
  const res = await fetch(
    `https://www.flickr.com/services/rest/?method=flickr.photos.search&api_key=${key}&text=${encodeURIComponent('"' + comEnName + '"')}&license=2,3,4,5,6,9&sort=relevance&per_page=15&media=photos&format=json&nojsoncallback=1`,
  );
  const j = (await res.json()) as { photos?: { photo: FlickrPhoto[] } };
  return (j.photos?.photo ?? []).map((p) => ({
    id: p.id,
    title: p.title,
    image_url: `https://farm${p.farm}.static.flickr.com/${p.server}/${p.id}_${p.secret}.jpg`,
    photos_url: `https://flickr.com/photos/${p.owner}/${p.id}`,
    author_url: `https://flickr.com/people/${p.owner}`,
  }));
}
