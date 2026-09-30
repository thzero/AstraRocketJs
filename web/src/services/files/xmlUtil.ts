/**
 * Tiny shared XML helpers for the file-format services (.ork/.rkt/.CDX1/SVG). One
 * escape implementation app-wide, since per-file copies drift apart on details
 * like whether the quote is escaped.
 */

export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Trimmed text of the first selector match; null when absent or empty. */
export function xmlText(el: Element, selector: string): string | null {
  const t = el.querySelector(selector)?.textContent;
  return t == null || t.trim() === '' ? null : t.trim();
}
