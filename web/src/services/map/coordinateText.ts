/**
 * A place typed or pasted as coordinates rather than a name.
 *
 * People copy a site from a map app, a club page or a GPS, and what they paste
 * is one of a handful of shapes: plain decimal pairs, a pair with hemisphere
 * letters, or a map link with the pair somewhere in its URL. All of those carry
 * the numbers themselves, so they are read here with no request at all.
 *
 * A shortened link (`maps.app.goo.gl/...`) carries nothing but a redirect, and
 * following it would be a request to a third party on the user's behalf, so it
 * is recognized only to say so.
 */

export type CoordinateText =
  | { kind: 'coords'; latitudeDeg: number; longitudeDeg: number }
  /** A shortened map link: the place is behind a redirect this does not follow. */
  | { kind: 'shortLink' };

const NUM = String.raw`[-+]?\d{1,3}(?:\.\d+)?`;

const inRange = (lat: number, lon: number) =>
  Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;

const pair = (lat: string | undefined, lon: string | undefined): CoordinateText | null => {
  if (lat === undefined || lon === undefined) return null;
  const a = Number(lat);
  const b = Number(lon);
  return inRange(a, b) ? { kind: 'coords', latitudeDeg: a, longitudeDeg: b } : null;
};

/** The pair in a map link's URL, wherever that service puts it. */
function fromUrl(url: URL): CoordinateText | null {
  const host = url.hostname.toLowerCase();
  if (host === 'maps.app.goo.gl' || host === 'goo.gl' || host === 'g.co') return { kind: 'shortLink' };
  const whole = decodeURIComponent(url.href);
  // Google's place pages pin the place itself with !3d<lat>!4d<lon>; the @ pair
  // beside it is only where the view is centered, so the pin wins.
  const pin = whole.match(new RegExp(`!3d(${NUM})!4d(${NUM})`));
  if (pin) return pair(pin[1], pin[2]);
  // Google and Apple: a pair as the search or the marker.
  for (const key of ['q', 'query', 'll', 'sll', 'center', 'daddr', 'destination']) {
    const v = url.searchParams.get(key);
    const m = v?.match(new RegExp(`^\\s*(${NUM})\\s*,\\s*(${NUM})\\s*$`));
    if (m) return pair(m[1], m[2]);
  }
  // OpenStreetMap's marker, then Bing's center (lat~lon).
  const mlat = url.searchParams.get('mlat');
  const mlon = url.searchParams.get('mlon');
  if (mlat && mlon) return pair(mlat, mlon);
  const cp = url.searchParams.get('cp')?.match(new RegExp(`^(${NUM})~(${NUM})$`));
  if (cp) return pair(cp[1], cp[2]);
  // Google's view center: /@lat,lon,zoom.
  const at = whole.match(new RegExp(`@(${NUM}),(${NUM})`));
  if (at) return pair(at[1], at[2]);
  // OpenStreetMap's view: #map=zoom/lat/lon.
  const osm = url.hash.match(new RegExp(`map=\\d+(?:\\.\\d+)?/(${NUM})/(${NUM})`));
  if (osm) return pair(osm[1], osm[2]);
  return null;
}

/**
 * A pair written out: `38.2544, -104.6091`, `38.2544 -104.6091`, or with
 * hemisphere letters and degree signs, `38.2544° N, 104.6091° W`, either
 * letter before or after its number.
 */
function fromPlain(text: string): CoordinateText | null {
  const t = text.trim().replace(/^geo:/i, '');
  const part = String.raw`([NSEW])?\s*(\d{1,3}(?:\.\d+)?|[-+]\d{1,3}(?:\.\d+)?)\s*°?\s*([NSEW])?`;
  const m = t.match(new RegExp(`^${part}\\s*[,;\\s]\\s*${part}$`, 'i'));
  if (!m) return null;
  const read = (before: string | undefined, num: string, after: string | undefined) => {
    const letter = (before ?? after)?.toUpperCase();
    if (before && after) return null; // one letter per number
    const v = Number(num);
    if (letter && /^[-+]/.test(num)) return null; // a letter and a sign would disagree
    return { v: letter === 'S' || letter === 'W' ? -v : v, letter };
  };
  const a = read(m[1], m[2]!, m[3]);
  const b = read(m[4], m[5]!, m[6]);
  if (!a || !b) return null;
  // Letters may put longitude first; without letters, latitude comes first.
  const latFirst = !(a.letter === 'E' || a.letter === 'W' || b.letter === 'N' || b.letter === 'S');
  const [lat, lon] = latFirst ? [a, b] : [b, a];
  if (lat.letter && !/[NS]/.test(lat.letter)) return null;
  if (lon.letter && !/[EW]/.test(lon.letter)) return null;
  return pair(String(lat.v), String(lon.v));
}

/** Coordinates in what was typed or pasted, or null when it is not coordinates (a place name, say). */
export function parseCoordinateText(text: string): CoordinateText | null {
  const t = text.trim();
  if (t === '') return null;
  if (/^https?:\/\//i.test(t)) {
    try {
      return fromUrl(new URL(t));
    } catch {
      return null;
    }
  }
  return fromPlain(t);
}
