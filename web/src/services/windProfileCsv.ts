import type { WindLevel } from './orkTree';

/**
 * CSV import for a multilevel wind profile, matching OpenRocket's
 * `MultiLevelPinkNoiseWindModel.importLevelsFromCSV` convenience overload:
 * headed columns named `altitude`, `speed`, `direction` and `stddev`, in
 * METERS, METERS PER SECOND and DEGREES, with the standard deviation optional.
 *
 * Fixed units rather than the user's display units, deliberately and like the
 * desktop: a sounding is a file someone else produced, so the file has to say
 * what it means on its own rather than inherit whatever the app happens to be
 * showing. The dialog states them.
 *
 * Whatever the file's order, the levels come back sorted by altitude. Import
 * REPLACES the profile (the desktop clears first), so a partial parse must not
 * be applied — every failure here throws rather than returning a short list.
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
  altitude: ['altitude', 'alt', 'altitudemsl', 'altitudeagl', 'height'],
  speed: ['speed', 'windspeed', 'velocity'],
  direction: ['direction', 'dir', 'heading', 'winddirection'],
  stddev: ['stddev', 'standarddeviation', 'deviation', 'sd', 'sigma'],
};

const norm = (h: string) =>
  h
    .trim()
    .toLowerCase()
    .replace(/[\s_()-]/g, '');

function columnIndex(headers: string[], key: keyof typeof ALIASES): number {
  const names = ALIASES[key];
  return headers.findIndex((h) => names.includes(norm(h)));
}

/** The separator the file uses: whichever of `,` `;` or tab the header has most of. */
function detectSeparator(headerLine: string): string {
  const counts = [',', ';', '\t'].map((sep) => [sep, headerLine.split(sep).length - 1] as const);
  const best = counts.reduce((a, b) => (b[1] > a[1] ? b : a));
  return best[1] > 0 ? best[0] : ',';
}

export function parseWindProfileCsv(text: string): WindLevel[] {
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
  const levels: WindLevel[] = [];

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const raw = lines[i]!;
    if (raw.trim() === '') continue;
    const cells = raw.split(sep);
    if (need >= cells.length) throw new WindProfileCsvError('shortRow', i + 1);

    const cell = (idx: number): number => {
      const v = Number(cells[idx]!.trim());
      if (!Number.isFinite(v)) throw new WindProfileCsvError('badNumber', i + 1);
      return v;
    };

    // Optional in the desktop too: a blank cell is no scatter, not a bad row.
    const sdCell = sdIdx >= 0 ? cells[sdIdx]!.trim() : '';
    levels.push({
      altitudeM: cell(altIdx),
      speed: cell(speedIdx),
      directionDeg: cell(dirIdx),
      stddev: sdCell === '' ? 0 : cell(sdIdx),
    });
  }

  if (!levels.length) throw new WindProfileCsvError('noData');
  return levels.sort((a, b) => a.altitudeM - b.altitudeM);
}
