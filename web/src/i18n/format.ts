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
