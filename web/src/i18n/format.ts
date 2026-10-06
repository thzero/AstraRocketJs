// Locale-aware number formatting, bound to the active i18n language. Use this
// for every DISPLAYED number (decimal separator + grouping differ per locale —
// "1,234.5" en-US vs "1.234,5" es-ES). Number <input> values stay canonical;
// the browser handles their locale separator, so inputs don't use this.
import i18n from './index';

const cache = new Map<string, Intl.NumberFormat>();

/** Format `n` with a fixed number of fraction digits in the current locale. */
export function fmtNum(n: number, digits = 0): string {
  if (!Number.isFinite(n)) return '—';
  const lng = i18n.resolvedLanguage || 'en';
  const key = `${lng}:${digits}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(lng, { minimumFractionDigits: digits, maximumFractionDigits: digits });
    cache.set(key, f);
  }
  return f.format(n);
}

/**
 * `n` to `sig` significant figures in the current locale, for a figure that spans
 * orders of magnitude (an inertia tile). Scientific notation below 1e-4, where
 * fixed digits would be all leading zeros.
 */
export function fmtSig(n: number, sig: number): string {
  if (!Number.isFinite(n)) return '—';
  if (n === 0) return '0';
  const lng = i18n.resolvedLanguage || 'en';
  const tiny = Math.abs(n) < 1e-4;
  return new Intl.NumberFormat(lng, {
    maximumSignificantDigits: sig,
    ...(tiny ? { notation: 'scientific', minimumSignificantDigits: sig } : {}),
  }).format(n);
}

/**
 * Decimal places the magnitude ladder gives a value — the precision a readout
 * wants when the unit can change under it, since the same quantity is 1234 in
 * one unit and 48.6 in another.
 */
export function ladderDigits(v: number): number {
  const a = Math.abs(v);
  return a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 2 : 3;
}

/**
 * Format with UP TO `digits` decimals, trailing zeros dropped — `fmtSi`'s
 * behavior, but locale-aware.
 *
 * For a figure that is round in the unit it was authored in and not in the
 * one it is being shown in: a 15-20 ft/s descent band is "15-20 ft/s" but
 * "4.6-6.1 m/s", and a fixed decimal count gets one of those two wrong.
 */
export function fmtUpTo(v: number, digits: number): string {
  if (!Number.isFinite(v)) return '—';
  const rounded = Number(v.toFixed(digits));
  return fmtNum(rounded, (String(rounded).split('.')[1] ?? '').length);
}

/**
 * A formatted value and its unit symbol. Degrees close up against the number
 * ("20°"); every other symbol takes a space ("8.94 m/s").
 */
export function withUnit(text: string, sym: string): string {
  return sym === '°' ? `${text}${sym}` : `${text} ${sym}`;
}

/**
 * A stage as every view labels it: its own name, else "Stage n" through one
 * interpolated key, so a language that puts the number first reads right. A
 * view passes the `t` it renders with; `index` is zero-based.
 */
export function stageLabel(
  t: (key: string, opts?: Record<string, unknown>) => string,
  index: number,
  name?: unknown,
): string {
  const own = typeof name === 'string' ? name.trim() : '';
  return own || t('flight.stageN', { n: index + 1 });
}

/**
 * A part as every view names it: its own name, trimmed, else its translated
 * type, else the raw type for one the locale does not know. A cleared Name field
 * writes `name: ''`, so an empty name falls back too.
 */
export function partLabel(
  t: (key: string, opts?: Record<string, unknown>) => string,
  node: { name?: unknown; type: string },
): string {
  const own = typeof node.name === 'string' ? node.name.trim() : '';
  return own || t(`part.${node.type}`, { defaultValue: node.type });
}

/**
 * An instant on the launch site's clock, with the zone named so it cannot be
 * read as the viewer's. `year: false` drops the year; `timeOnly` gives just the
 * hour and minute (a table of hours on one known day). A zone the browser does
 * not know (it comes from Open-Meteo and from a saved weather source) falls back
 * to the viewer's clock rather than throwing in the middle of a render.
 */
export function fmtSiteTime(
  at: string | number | Date,
  timeZone: string | undefined,
  opts: { year?: boolean; timeOnly?: boolean } = {},
): string {
  const lng = i18n.resolvedLanguage || 'en';
  const fields: Intl.DateTimeFormatOptions = opts.timeOnly
    ? { hour: '2-digit', minute: '2-digit' }
    : {
        ...(opts.year === false ? {} : { year: 'numeric' }),
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        // Explicit fields: dateStyle and timeStyle refuse a timeZoneName beside them.
        timeZoneName: 'short',
      };
  const date = new Date(at);
  try {
    return new Intl.DateTimeFormat(lng, { ...fields, timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat(lng, fields).format(date);
  }
}

const MB = 1024 * 1024;

/**
 * Bytes as megabytes, for the two download progress readouts (the boot splash
 * and the catalog loader). It lived in both, verbatim, with a bare `toFixed(1)`
 * — so the one number those panels show was the only displayed number in the
 * app not following the user's locale.
 */
export function fmtMb(bytes: number): string {
  return fmtNum(bytes / MB, 1);
}
