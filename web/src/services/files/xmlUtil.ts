/**
 * Tiny shared XML helpers for the file-format services (.ork/.rkt/.CDX1/SVG). One
 * escape implementation app-wide, since per-file copies drift apart on details
 * like whether the quote is escaped.
 */

export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Parse an XML text, a leading byte-order mark dropped. Throws `error` when the
 * parser reports a fault, since DOMParser answers a document either way.
 */
export function parseXmlText(xml: string, error: string): Document {
  if (xml.charCodeAt(0) === 0xfeff) xml = xml.slice(1);
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  if (doc.querySelector('parsererror')) throw new Error(error);
  return doc;
}

/** Trimmed text of the first selector match; null when absent or empty. */
export function xmlText(el: Element, selector: string): string | null {
  const t = el.querySelector(selector)?.textContent;
  return t == null || t.trim() === '' ? null : t.trim();
}
