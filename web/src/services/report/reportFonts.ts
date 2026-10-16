import type { jsPDF } from 'jspdf';

/**
 * The report's Unicode fonts.
 *
 * jsPDF's built-in Helvetica writes WinAnsi only: Latin-1 plus the Windows-1252
 * punctuation (dashes, curly quotes, the ellipsis, the euro sign), and only
 * when that punctuation is handed over as its single WinAnsi byte. Any other
 * character turns the whole string into bytes the font cannot show. Text
 * outside WinAnsi is drawn in a Noto font instead, fetched from
 * `public/fonts/` the first time a report needs it, so the app bundle does not
 * carry fonts that most reports never use.
 *
 * Two families, chosen per text run:
 *
 * - `latin`: Noto Sans, Latin, Greek and Cyrillic plus the arrows and math
 *   operators from Noto Sans Math (Polish, Russian, "CNα", "Ø a → b").
 * - `jp`: Noto Sans JP, kana and the level 1 kanji, plus every glyph of the
 *   Latin family, so a run that mixes Japanese with anything else needs one
 *   font. When a report needs it, it serves the `latin` runs too.
 *
 * The service worker stores the files on first use (vite.config.ts), so a
 * report that worked once works offline. A file that cannot be fetched leaves
 * its runs in Helvetica, with ASCII stand-ins where there are obvious ones.
 */

export type UnicodeScript = 'latin' | 'jp';

/** The family name each script's runs are drawn in, for the scripts registered. */
export type ReportFamilies = Partial<Record<UnicodeScript, string>>;

/** One family's two weights, as base64 TTF data for jsPDF's virtual file system. */
interface FamilyFiles {
  family: string;
  regular: { file: string; data: string };
  bold: { file: string; data: string };
}

/** The font data a report was given: the family each script is drawn in. */
export type ReportFontFiles = Partial<Record<UnicodeScript, FamilyFiles>>;

const FAMILIES: Record<UnicodeScript, { family: string; regular: string; bold: string }> = {
  latin: { family: 'NotoSans', regular: 'NotoSans-Regular.ttf', bold: 'NotoSans-Bold.ttf' },
  jp: { family: 'NotoSansJP', regular: 'NotoSansJP-Regular.ttf', bold: 'NotoSansJP-Bold.ttf' },
};

/** The characters above Latin-1 that Helvetica writes, by code point, as their WinAnsi byte. */
const WIN_ANSI = new Map<number, number>([
  [0x20ac, 0x80],
  [0x201a, 0x82],
  [0x0192, 0x83],
  [0x201e, 0x84],
  [0x2026, 0x85],
  [0x2020, 0x86],
  [0x2021, 0x87],
  [0x02c6, 0x88],
  [0x2030, 0x89],
  [0x0160, 0x8a],
  [0x2039, 0x8b],
  [0x0152, 0x8c],
  [0x017d, 0x8e],
  [0x2018, 0x91],
  [0x2019, 0x92],
  [0x201c, 0x93],
  [0x201d, 0x94],
  [0x2022, 0x95],
  [0x2013, 0x96],
  [0x2014, 0x97],
  [0x02dc, 0x98],
  [0x2122, 0x99],
  [0x0161, 0x9a],
  [0x203a, 0x9b],
  [0x0153, 0x9c],
  [0x017e, 0x9e],
  [0x0178, 0x9f],
  // The narrow, thin and figure spaces that locales group thousands with
  // (French writes 1 234 with U+202F): the no-break space, so a number never
  // needs a Unicode font.
  [0x202f, 0xa0],
  [0x2009, 0xa0],
  [0x2007, 0xa0],
]);

/** Has a character Helvetica cannot write. */
function beyondWinAnsi(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c > 0xff && !WIN_ANSI.has(c)) return true;
  }
  return false;
}

// CJK punctuation, kana, the CJK ideograph blocks and the halfwidth and
// fullwidth forms: the characters only the JP family carries.
const CJK = /[\u2e80-\u2fdf\u3000-\u30ff\u31f0-\u31ff\u3200-\u9fff\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef]/;

/** Which Unicode family a run needs, or null when Helvetica can write it. */
export function scriptOf(text: string): UnicodeScript | null {
  if (!beyondWinAnsi(text)) return null;
  return CJK.test(text) ? 'jp' : 'latin';
}

/** ASCII stand-ins for symbols the report writes outside WinAnsi. */
const STAND_INS: Record<string, string> = {
  '→': '->',
  '←': '<-',
  α: 'a',
  '−': '-',
  '≈': '~',
  '≤': '<=',
  '≥': '>=',
  ł: 'l',
  Ł: 'L',
};

/**
 * The run as Helvetica writes it: Latin-1 kept, the Windows-1252 punctuation
 * turned into its WinAnsi byte, a known symbol or an accented letter replaced
 * by its ASCII stand-in, and anything else by `?`. `lost` says whether
 * anything had no stand-in.
 */
export function toWinAnsi(text: string): { text: string; lost: boolean } {
  let wide = false;
  for (let i = 0; i < text.length && !wide; i++) wide = text.charCodeAt(i) > 0xff;
  if (!wide) return { text, lost: false };
  let lost = false;
  let out = '';
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c <= 0xff) {
      out += ch;
      continue;
    }
    const byte = WIN_ANSI.get(c);
    if (byte != null) {
      out += String.fromCharCode(byte);
      continue;
    }
    const stand = STAND_INS[ch];
    if (stand != null) {
      out += stand;
      continue;
    }
    // A letter with a diacritic Latin-1 does not have: its base letter.
    const base = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (base && !beyondWinAnsi(base) && base.charCodeAt(0) <= 0xff) {
      out += base;
      continue;
    }
    out += '?';
    lost = true;
  }
  return { text: out, lost };
}

/** Bytes to the base64 jsPDF's `addFileToVFS` takes, in chunks small enough to spread. */
function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

type Fetch = (url: string) => Promise<Response>;

// One fetch per file per session. A failure is forgotten, so the next report
// tries again (the network may be back).
const memo = new Map<string, Promise<string>>();

function fetchFont(file: string, fetcher: Fetch): Promise<string> {
  let got = memo.get(file);
  if (!got) {
    got = fetcher(`${import.meta.env.BASE_URL}fonts/${file}`).then(async (res) => {
      if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
      return toBase64(await res.arrayBuffer());
    });
    memo.set(file, got);
    got.catch(() => memo.delete(file));
  }
  return got;
}

/** Both weights of one family, or null when either cannot be fetched. */
async function loadFamily(script: UnicodeScript, fetcher: Fetch): Promise<FamilyFiles | null> {
  const f = FAMILIES[script];
  try {
    const [regular, bold] = await Promise.all([fetchFont(f.regular, fetcher), fetchFont(f.bold, fetcher)]);
    return {
      family: f.family,
      regular: { file: f.regular, data: regular },
      bold: { file: f.bold, data: bold },
    };
  } catch {
    return null;
  }
}

/**
 * The fonts for the scripts a report's text needs. The JP family carries the
 * Latin family's glyphs, so a report that needs it fetches only it; the Latin
 * family is fetched for a report without Japanese, or when the JP family
 * cannot be had and some runs could still use the smaller one.
 */
export async function loadReportFonts(
  needs: ReadonlySet<UnicodeScript>,
  fetcher: Fetch = (url) => fetch(url),
): Promise<ReportFontFiles> {
  if (needs.has('jp')) {
    const jp = await loadFamily('jp', fetcher);
    if (jp) return { jp, latin: jp };
  }
  if (needs.has('latin')) {
    const latin = await loadFamily('latin', fetcher);
    if (latin) return { latin };
  }
  return {};
}

/** Register the fetched fonts with one document; returns the family per script. */
export function registerReportFonts(doc: jsPDF, files: ReportFontFiles): ReportFamilies {
  const out: ReportFamilies = {};
  const done = new Set<string>();
  for (const [script, f] of Object.entries(files) as [UnicodeScript, FamilyFiles][]) {
    if (!done.has(f.family)) {
      for (const [w, style] of [
        [f.regular, 'normal'],
        [f.bold, 'bold'],
      ] as const) {
        doc.addFileToVFS(w.file, w.data);
        doc.addFont(w.file, f.family, style);
      }
      done.add(f.family);
    }
    out[script] = f.family;
  }
  return out;
}

/** Forget fetched fonts, so a test starts from an empty session. */
export function resetReportFontsForTests(): void {
  memo.clear();
}
