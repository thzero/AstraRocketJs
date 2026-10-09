import type { WindLevel } from '../design/orkTree';
import { norm360 } from './groundTrack';

/**
 * CSV import for a multilevel wind profile, matching OpenRocket's
 * `MultiLevelPinkNoiseWindModel.importLevelsFromCSV` convenience overload:
 * headed columns named `altitude`, `speed`, `direction` and `stddev`, in
 * meters, meters per second and degrees, with the standard deviation optional.
 *
 * Fixed units rather than the user's display units, deliberately and like the
 * desktop: a sounding is a file someone else produced, so the file has to say
 * what it means on its own rather than inherit whatever the app happens to be
 * showing. The dialog states them.
 *
 * Whatever the file's order, the levels come back sorted by altitude. Import
 * replaces the profile (the desktop clears first), so a partial parse must not
 * be applied: every failure here throws rather than returning a short list.
 */

export class WindProfileCsvError extends Error {
  /** i18n key under `windProfile.csv`, so the dialog can say which fault it was. */
  readonly key: string;
  readonly line?: number;

  constructor(key: string, line?: number) {
    super(key);
    this.name = 'WindProfileCsvError';
    this.key = key;
    this.line = line;
  }
}

const ALIASES: Record<keyof Omit<WindLevel, 'altitudeM' | 'directionDeg'> | 'altitude' | 'direction', string[]> = {
  altitude: ['altitude', 'alt', 'altitudemsl', 'altitudeagl', 'altitudem', 'altitudemslm', 'altitudeaglm', 'height'],
  speed: ['speed', 'windspeed', 'velocity', 'speedms', 'windspeedms'],
  direction: ['direction', 'dir', 'heading', 'winddirection', 'directiondeg', 'headingdeg'],
  stddev: ['stddev', 'standarddeviation', 'deviation', 'sd', 'sigma', 'stddevms'],
};

/**
 * Strip one pair of surrounding double quotes (and a doubled inner quote): a
 * spreadsheet quotes any header carrying a comma, space or parenthesis, so
 * `"altitude (m)"` would otherwise arrive with its quotes on and match nothing.
 */
const unquote = (s: string) => {
  const t = s.trim();
  return t.length >= 2 && t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1).replace(/""/g, '"') : t;
};

// Letters and digits only, so `speed (m/s)` and `wind-speed_m/s` both read as
// `speedms`; a unit suffix in the header is what a spreadsheet export carries.
const norm = (h: string) =>
  unquote(h)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

function columnIndex(headers: string[], key: keyof typeof ALIASES): number {
  const names = ALIASES[key];
  return headers.findIndex((h) => names.includes(norm(h)));
}

/**
 * The levels, plus what the altitude column said it was measured from when
 * the header named it (`altitude AGL`, `altitude MSL`). Still an array, so a
 * caller can iterate it and ignore `reference`.
 */
export type WindProfileCsvResult = WindLevel[] & { reference?: 'msl' | 'agl' };

/** The reference an altitude header carries, or undefined when it says nothing. */
function altitudeReference(header: string): 'msl' | 'agl' | undefined {
  const n = norm(header);
  if (n.includes('agl')) return 'agl';
  if (n.includes('msl')) return 'msl';
  return undefined;
}

/**
 * A number cell, read as the desktop's `extractDouble` reads it: as written,
 * else with its last comma taken as the decimal point, so a semicolon-separated
 * European export ("5,5") imports. NaN when neither reading is a number.
 */
function decimal(text: string): number {
  const v = Number(text);
  if (Number.isFinite(v)) return v;
  const comma = text.lastIndexOf(',');
  return comma < 0 ? NaN : Number(`${text.slice(0, comma)}.${text.slice(comma + 1)}`);
}

/** The separator the file uses: whichever of `,` `;` or tab the header has most of. */
function detectSeparator(headerLine: string): string {
  const counts = [',', ';', '\t'].map((sep) => [sep, headerLine.split(sep).length - 1] as const);
  const best = counts.reduce((a, b) => (b[1] > a[1] ? b : a));
  return best[1] > 0 ? best[0] : ',';
}

export function parseWindProfileCsv(text: string): WindProfileCsvResult {
  // Strip a UTF-8 BOM: a spreadsheet export carries one and it would otherwise
  // ride on the first header name and stop it matching `altitude`.
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const headerIdx = lines.findIndex((l) => l.trim() !== '');
  if (headerIdx < 0) throw new WindProfileCsvError('emptyFile');

  const sep = detectSeparator(lines[headerIdx]!);
  const headers = lines[headerIdx]!.split(sep);
  const altIdx = columnIndex(headers, 'altitude');
  const speedIdx = columnIndex(headers, 'speed');
  const dirIdx = columnIndex(headers, 'direction');
  const sdIdx = columnIndex(headers, 'stddev');
  if (altIdx < 0 || speedIdx < 0 || dirIdx < 0) throw new WindProfileCsvError('missingColumns');

  const need = Math.max(altIdx, speedIdx, dirIdx, sdIdx);
  const levels: WindProfileCsvResult = [];
  // `altitudeagl` carries a reference, so it is not a plain alias: dropped, the
  // levels import as MSL, which at a 1500 m site is a different wind. The caller
  // applies it; a header that says nothing leaves it unset.
  const reference = altitudeReference(headers[altIdx]!);
  if (reference) levels.reference = reference;

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const raw = lines[i]!;
    if (raw.trim() === '') continue;
    const cells = raw.split(sep);
    if (need >= cells.length) throw new WindProfileCsvError('shortRow', i + 1);

    const cell = (idx: number): number => {
      const text = unquote(cells[idx]!);
      // `Number('')` is 0, and 0 passes `Number.isFinite`, so without this a
      // blank altitude or speed would import as a real 0 reading instead of
      // failing the row. Blank is only meaningful for `stddev`, handled below.
      if (text === '') throw new WindProfileCsvError('badNumber', i + 1);
      const v = decimal(text);
      if (!Number.isFinite(v)) throw new WindProfileCsvError('badNumber', i + 1);
      return v;
    };

    // Optional in the desktop too: a blank cell is no scatter, not a bad row.
    const sdCell = sdIdx >= 0 ? unquote(cells[sdIdx]!) : '';
    // A negative speed is a wind from the opposite heading; the desktop import
    // stores it that way (PinkNoiseWindModel.setAverage), so the table shows
    // the wind the kernel flies.
    const speed = cell(speedIdx);
    const directionDeg = cell(dirIdx);
    levels.push({
      altitudeM: cell(altIdx),
      speed: Math.abs(speed),
      directionDeg: speed < 0 ? norm360(directionDeg + 180) : directionDeg,
      stddev: sdCell === '' ? 0 : cell(sdIdx),
    });
  }

  if (!levels.length) throw new WindProfileCsvError('noData');
  return levels.sort((a, b) => a.altitudeM - b.altitudeM);
}
