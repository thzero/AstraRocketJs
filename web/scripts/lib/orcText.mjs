// Readers for the text of OpenRocket's XML (`.orc` part files, the `.ork` a
// design is saved as), matched as text rather than parsed: the files are
// regular enough, and a parser would be a dependency the sync scripts have no
// other use for.

/** The entities XML names itself; a file can carry no other names. */
const XML_ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

/** Element text with its XML entity and character references resolved, as an XML parser reads it. */
export const xmlText = (s) =>
  s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, ref) => {
    if (ref[0] !== '#') return XML_ENTITIES[ref] ?? whole;
    const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
    return String.fromCodePoint(code);
  });

/** SI factor for each `Unit` attribute a `.orc` length carries. */
const LEN = { in: 0.0254, mm: 0.001, cm: 0.01, m: 1, ft: 0.3048, '': 1 };

/**
 * An element's text and unit. A part that repeats an element keeps the last
 * one, as desktop's JAXB loader does: each occurrence sets the same field.
 */
export function tag(block, name) {
  const all = [...block.matchAll(new RegExp(`<${name}(\\s+[^>]*)?>([^<]*)</${name}>`, 'g'))];
  const m = all.at(-1);
  if (!m) return null;
  const unit = (m[1] || '').match(/Unit="([^"]*)"/)?.[1] ?? '';
  return { value: xmlText(m[2]).trim(), unit };
}

/** A length element in meters; null when absent, empty or not a number. */
export const lenM = (block, name) => {
  const t = tag(block, name);
  if (!t || t.value === '') return null;
  const n = Number(t.value);
  return Number.isFinite(n) ? n * (LEN[t.unit] ?? 1) : null;
};

/** A numeric element; null when absent or not a number. */
export const num = (block, name) => {
  const t = tag(block, name);
  const n = t ? Number(t.value) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** An element's text; null when absent. */
export const str = (block, name) => tag(block, name)?.value ?? null;
