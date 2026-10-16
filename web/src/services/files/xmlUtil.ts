import { KeyedError } from '../../i18n/keyedError';

/**
 * Tiny shared XML helpers for the file-format services (.ork/.rkt/.CDX1/SVG). One
 * escape implementation app-wide, since per-file copies drift apart on details
 * like whether the quote is escaped.
 */

/**
 * Escape text for an XML attribute or element. The characters XML 1.0 forbids
 * are dropped (see {@link stripXmlForbidden}), because it forbids them even as
 * character references and a parser (Google Earth, a slicer, the desktop)
 * rejects the whole file over one. A name pasted from a word processor carries
 * U+000B for its line breaks.
 */
export function escapeXml(s: string): string {
  return stripXmlForbidden(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Drop the characters XML 1.0 forbids: C0 controls other than tab, line feed and
 * carriage return, U+FFFE and U+FFFF, and a surrogate that is not half of a
 * pair. A paired surrogate is kept with its partner, since the pair is one
 * character outside the BMP that XML allows. Compared by code unit rather than
 * with a control-character class, which `no-control-regex` rejects.
 */
function stripXmlForbidden(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) continue;
    if (c === 0xfffe || c === 0xffff) continue;
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += s[i]! + s[i + 1]!;
        i++;
      }
      continue;
    }
    if (c >= 0xdc00 && c <= 0xdfff) continue;
    out += s[i];
  }
  return out;
}

/**
 * Parse an XML text, a leading byte-order mark dropped. Throws a keyed error
 * naming `format` (the file extension, such as `.ork`) when the parser reports
 * a fault, since DOMParser answers a document either way.
 */
export function parseXmlText(xml: string, format: string): Document {
  if (xml.charCodeAt(0) === 0xfeff) xml = xml.slice(1);
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  if (doc.querySelector('parsererror')) throw new KeyedError('errors.file.xmlInvalid', { format });
  return doc;
}

/** Trimmed text of the first selector match; null when absent or empty. */
export function xmlText(el: Element, selector: string): string | null {
  const t = el.querySelector(selector)?.textContent;
  return t == null || t.trim() === '' ? null : t.trim();
}
