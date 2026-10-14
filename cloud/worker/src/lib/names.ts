/**
 * Naming rules copied from BirdNET-Pi (utils/reporting.py and the PHP pages).
 * These must match the Pi exactly, because the Pi's directory and file names
 * are derived from them and the agent uploads files under the same keys.
 */

/** Common name as used in directory and file names: spaces to _, apostrophes removed. */
export function comNameSafe(comName: string): string {
  return comName.replace(/'/g, '').replace(/ /g, '_');
}

/** R2 key for a detection's audio clip. The spectrogram is the same key + '.png'. */
export function mediaKey(date: string, comName: string, fileName: string): string {
  return `by_date/${date}/${comNameSafe(comName)}/${fileName}`;
}

export function shiftedKey(date: string, comName: string, fileName: string): string {
  return `by_date/shifted/${date}/${comNameSafe(comName)}/${fileName}`;
}

/** Path relative to the Pi's EXTRACTED/By_Date directory, as the Pi's play.php uses it. */
export function piRelativePath(date: string, comName: string, fileName: string): string {
  return `${date}/${comNameSafe(comName)}/${fileName}`;
}

export interface ParsedFileName {
  comNameSafe: string;
  confidencePct: number;
  date: string;
  rtspId: string;
  time: string;
  ext: string;
}

/**
 * Parse `<Com_Name_safe>-<pct>-<YYYY-MM-DD>-birdnet-[RTSP_<N>-]<HH:MM:SS>.<ext>`.
 * Returns null when the name does not follow the convention.
 */
export function parseFileName(fileName: string): ParsedFileName | null {
  const m = fileName.match(/^(.+)-(\d{1,3})-(\d{4}-\d{2}-\d{2})-birdnet-(RTSP_\d+-)?(\d{2}:\d{2}:\d{2})\.([A-Za-z0-9]+)$/);
  if (!m) return null;
  return {
    comNameSafe: m[1],
    confidencePct: Number(m[2]),
    date: m[3],
    rtspId: m[4] ?? '',
    time: m[5],
    ext: m[6],
  };
}

/** Wikipedia article title form of a scientific name. */
export function wikiTitle(sciName: string): string {
  return sciName.replace(/ /g, '_');
}

/** All About Birds guide slug: English name, spaces to _, apostrophes removed. */
export function allAboutBirdsSlug(comEnName: string): string {
  return comEnName.replace(/'/g, '').replace(/ /g, '_');
}

/** Reject anything that could escape a key prefix. */
export function safeKeySegment(s: string): boolean {
  return s.length > 0 && !s.includes('..') && !s.includes('//') && !s.startsWith('/');
}
