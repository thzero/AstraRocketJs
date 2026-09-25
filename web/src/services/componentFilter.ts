// Searching, ranking and describing the component catalog — everything the
// picker needs that is not a DOM concern, so the interesting half can be tested
// without rendering a dialog.
//
// The catalog is SI throughout (meters), like componentDb.
import type { Component, ComponentType, PickerType } from './componentDb';

/**
 * How far UNDER a bore a part may be and still be a fit, in meters. A coupler is
 * cut undersize on purpose, and 2 mm of that is a normal glue gap; much more and
 * it rattles rather than fits.
 */
const FIT_SLACK = 0.002;
/** How much LARGER than the bore a part may be and still be called a fit. A
 *  coupler never goes in oversize, but catalog numbers are nominal and round
 *  differently per manufacturer, so a few hundredths is noise, not interference. */
const FIT_OVERSIZE = 0.0005;
/**
 * How far apart two outer diameters may be and still CONTINUE one airframe, in
 * meters. Much tighter than FIT_SLACK: a coupler may be 2 mm under its tube, but
 * two tubes 2 mm apart in outer diameter are not the same tube, they are a
 * visible step in the airframe.
 */
const MATCH_TOL = 0.0006;

/**
 * The geometry around the node being filled, in meters. Any field may be absent:
 * a body tube hanging off a stage has no enclosing bore, and a freshly added
 * part has no children yet.
 *
 * This is what makes the picker better than a flat catalog list. The part being
 * chosen almost always has to fit something that is already in the design, and
 * until now the picker was told only the component TYPE, so it could not put the
 * couplers that actually fit a 41.6 mm bore above the 236 that do not.
 */
export interface FitContext {
  /** Bore of the enclosing body: what a coupler, ring or bulkhead fits INSIDE. */
  parentInner?: number;
  /** Outer diameter of the enclosing body. */
  parentOuter?: number;
  /** Outer diameter of the inner tube this part has to clear: a centering
   *  ring's bore is sized to the motor mount it holds, which sits beside it in
   *  the same body tube rather than inside it. */
  mountOuter?: number;
  /** Outer diameters of the airframe already in this design, for the parts whose
   *  job is to CONTINUE the stack rather than fit inside it. */
  airframeOuter?: number[];
}

/** Which dimension of a candidate has to line up with what, per part type. */
type FitRule =
  /** Candidate OD slides inside a bore. */
  | { kind: 'inside'; target: number }
  /** Candidate OD continues an airframe: same size, either way off. */
  | { kind: 'match'; targets: number[] };

/**
 * What "fits" means for each catalog type, given the surrounding geometry.
 * Returns null when the context cannot judge this type, which is not a failure:
 * the fit control is simply unavailable, rather than silently filtering
 * everything out.
 */
export function fitRuleFor(type: PickerType, fit: FitContext | undefined): FitRule | null {
  if (!fit) return null;
  switch (type) {
    // These live INSIDE an airframe, so the bore is the constraint.
    case 'tubecoupler':
    case 'centeringring':
    case 'bulkhead':
      return fit.parentInner != null && fit.parentInner > 0 ? { kind: 'inside', target: fit.parentInner } : null;
    // These ARE the airframe, so they continue it. The enclosing body's OD comes
    // first (a tube inside a pod matches that pod), else any airframe OD already
    // in the design.
    case 'bodytube':
    case 'nosecone': {
      const targets =
        fit.parentOuter != null && fit.parentOuter > 0
          ? [fit.parentOuter]
          : (fit.airframeOuter ?? []).filter((d) => d > 0);
      return targets.length > 0 ? { kind: 'match', targets } : null;
    }
    // A parachute's fit is about PACKED volume, which the model does not carry
    // (see TODO: recovery-device packed length/radius). Ranking it by canopy
    // diameter against a bore would be confidently wrong, so it abstains.
    case 'parachute':
      return null;
    // An inner tube abstains too, for the opposite reason: the constraint that
    // decides it is the MOTOR it has to take, and the motor belongs to a
    // simulation rather than to the tree, so nothing here knows it. Scoring its
    // outer diameter against the enclosing bore would rank a snug 51 mm sleeve
    // above the 29 mm mount that is actually wanted. The outer-diameter range
    // answers the physical question instead.
    case 'innertube':
      return null;
  }
}

/** The outer diameter a fit rule measures, or null for a part that has none. */
function outerOf(p: Component): number | null {
  return p.type === 'parachute' ? null : p.outerDiameter;
}

/**
 * How well a part fits, in meters of error: 0 is exact, larger is worse, and
 * null means "not judged" (no rule, or the part is outside the tolerance band
 * entirely). Null sorts last and is what `fitsOnly` filters out.
 */
export function fitScore(p: Component, rule: FitRule | null): number | null {
  if (!rule) return null;
  const od = outerOf(p);
  if (od == null) return null;
  if (rule.kind === 'inside') {
    // `gap` is how much room is left in the bore: positive when the part is
    // under it, negative when it is over. A snug fit is a small positive gap;
    // a part far under the bore rattles around in it and is not a fit at all,
    // which is why this is a band rather than just `od <= target`.
    const gap = rule.target - od;
    return gap >= -FIT_OVERSIZE && gap <= FIT_SLACK ? Math.abs(gap) : null;
  }
  const best = Math.min(...rule.targets.map((tgt) => Math.abs(tgt - od)));
  return best <= MATCH_TOL ? best : null;
}

/** A centering ring also has to clear what it centers, not just fit the bore. */
export function boreClears(p: Component, fit: FitContext | undefined): boolean {
  if (p.type !== 'centeringring' || !fit?.mountOuter) return true;
  const id = p.innerDiameter;
  return id == null || id + FIT_SLACK >= fit.mountOuter;
}

/**
 * Material FAMILY rules, first match wins. Order matters: "Fiberglass, G12,
 * filament wound tube, bulk" and "Carbon fiber epoxy composite" both contain
 * "fiber", and "PML glassed phenolic" is a phenolic rather than a glass.
 *
 * The catalog's raw names cannot be a filter: body tubes alone carry 39 of them,
 * including eight near-duplicate `Fiber, vulcanized, Coupler, BT-xx, bulk` rows
 * and three spellings of the same balsa density. The family is the question
 * people actually ask ("show me the fiberglass tubes"), and it collapses those 39
 * to six. Every name in the shipped catalog lands in one of these; the test
 * asserts that, so a new material cannot quietly fall through.
 */
const MATERIAL_FAMILIES: [RegExp, string][] = [
  [/phenolic/i, 'Phenolic'],
  [/fiberglass/i, 'Fiberglass'],
  [/carbon/i, 'Carbon fiber'],
  [/plywood/i, 'Plywood'],
  [/^birch\b/i, 'Birch'],
  [/balsa/i, 'Balsa'],
  [/paper|cardboard/i, 'Paper'],
  [/foam/i, 'Foam'],
  [/mylar|polycarbonate|polyethylene|polypropylene|polystyrene|polymer|urethane|acrylic|nylon|plastic/i, 'Plastic'],
  [/fiber/i, 'Fiber'],
];

/**
 * The family a part's material belongs to, or null when it has no material at
 * all (a parachute) or the name matches no rule.
 *
 * NOT translated, deliberately. The Material column beside the facet shows the
 * catalog's own English names, because that is what a catalog of English-language
 * manufacturer data contains; a facet translated into the reader's language, sitting over rows reading
 * "Fiberglass, G10, bulk" would be worse than one that matches them.
 */
export function materialFamily(p: Component): string | null {
  const name = 'material' in p ? p.material : undefined;
  if (!name) return null;
  for (const [re, family] of MATERIAL_FAMILIES) if (re.test(name)) return family;
  return null;
}

/**
 * The drag coefficient the app falls back to when the catalog omits one, which
 * it does for every parachute it ships: all 151 rows carry a null, because
 * OpenRocket's preset files have no DragCoefficient for a parachute. Exported so
 * the column, its sort and `treeEdit.catalogPatch` cannot drift apart.
 */
export const DEFAULT_CHUTE_CD = 0.8;

export type SortKey = 'fit' | 'mfr' | 'partNo' | 'od' | 'id' | 'length' | 'shape' | 'cd';

export interface ComponentQuery {
  /** Free text, whitespace-separated terms AND-ed across mfr / part no / desc. */
  text: string;
  /** Exact manufacturer, or '' for all. */
  mfr: string;
  /** Material family (see materialFamily), or '' for all. */
  material: string;
  /** Nose cone shape, or '' for all. Ignored by every other type. */
  shape: string;
  /** Outer-diameter bounds in meters; null for unbounded. */
  odMin: number | null;
  odMax: number | null;
  /** Keep only parts that fit the surrounding geometry. */
  fitsOnly: boolean;
  sort: SortKey;
  dir: 1 | -1;
}

export const emptyQuery: ComponentQuery = {
  text: '',
  mfr: '',
  material: '',
  shape: '',
  odMin: null,
  odMax: null,
  fitsOnly: false,
  sort: 'fit',
  dir: 1,
};

/** Whether anything is actually narrowing the list (for a "clear" affordance). */
export const queryIsEmpty = (q: ComponentQuery): boolean =>
  !q.text.trim() && !q.mfr && !q.material && !q.shape && q.odMin == null && q.odMax == null && !q.fitsOnly;

const textMatches = (p: Component, terms: string[]): boolean => {
  if (terms.length === 0) return true;
  // The material is in here as well as in its own facet: the facet groups by
  // family, so `g12` or `mylar` would otherwise be unreachable by name.
  const mat = 'material' in p ? (p.material ?? '') : '';
  const hay = `${p.mfr} ${p.partNo} ${p.desc} ${mat}`.toLowerCase();
  return terms.every((term) => hay.includes(term));
};

/** The value a sort key reads, or null when the part has no such dimension. */
function sortValue(p: Component, key: SortKey): string | number | null {
  switch (key) {
    case 'mfr':
      return p.mfr.toLowerCase();
    case 'partNo':
      return p.partNo.toLowerCase();
    case 'od':
      return p.type === 'parachute' ? p.diameter : p.outerDiameter;
    case 'id':
      return 'innerDiameter' in p ? p.innerDiameter : null;
    case 'length':
      return p.type === 'parachute' ? null : p.length;
    case 'shape':
      return p.type === 'nosecone' ? p.shape : null;
    case 'cd':
      // The default the picker will apply, so the column and its order agree.
      return p.type === 'parachute' ? (p.cd ?? DEFAULT_CHUTE_CD) : null;
    case 'fit':
      return null; // ranked from the scores in `cmp`, not from the part
  }
}

/** A row and the fit score it was ranked by, so the UI can show the reason. */
export interface Ranked<C extends Component> {
  part: C;
  /** Meters of error against the surrounding geometry, or null if not judged. */
  fit: number | null;
}

/**
 * Filter, rank and sort in one pass. The result is every match, NOT a page of
 * them: capping belongs to the renderer, which has to be able to say how many
 * it is holding back. (The old picker sliced to 300 and then reported that
 * number as the total, so 1088 body tubes read as "300 parts".)
 */
export function queryComponents<C extends Component>(
  list: C[],
  q: ComponentQuery,
  type: PickerType,
  fit?: FitContext,
): Ranked<C>[] {
  const terms = q.text.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const rule = fitRuleFor(type, fit);

  const rows: Ranked<C>[] = [];
  for (const part of list) {
    if (!textMatches(part, terms)) continue;
    if (q.mfr && part.mfr !== q.mfr) continue;
    if (q.material && materialFamily(part) !== q.material) continue;
    if (q.shape && !(part.type === 'nosecone' && part.shape === q.shape)) continue;
    const od = part.type === 'parachute' ? part.diameter : part.outerDiameter;
    if (q.odMin != null && od < q.odMin) continue;
    if (q.odMax != null && od > q.odMax) continue;
    const score = boreClears(part, fit) ? fitScore(part, rule) : null;
    if (q.fitsOnly && score == null) continue;
    rows.push({ part, fit: score });
  }

  const cmp = (a: Ranked<C>, b: Ranked<C>): number => {
    if (q.sort === 'fit') {
      // A row with no score goes last whichever way the arrow points: it is not
      // "the worst fit", it is absent from the ranking.
      if (a.fit == null && b.fit == null) return a.part.mfr.localeCompare(b.part.mfr);
      if (a.fit == null) return 1;
      if (b.fit == null) return -1;
      return (a.fit - b.fit) * q.dir;
    }
    const av = sortValue(a.part, q.sort);
    const bv = sortValue(b.part, q.sort);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === 'string' || typeof bv === 'string') return String(av).localeCompare(String(bv)) * q.dir;
    return (av - bv) * q.dir;
  };
  return rows.sort(cmp);
}

/** Every manufacturer in a list, for the facet, alphabetical. */
export const manufacturers = (list: Component[]): string[] =>
  [...new Set(list.map((p) => p.mfr))].sort((a, b) => a.localeCompare(b));

/** Every material family present in a list, for the facet, alphabetical. */
export const materialFamilies = (list: Component[]): string[] =>
  [...new Set(list.map(materialFamily).filter((f): f is string => f != null))].sort((a, b) => a.localeCompare(b));

/** Every nose cone shape present in a list, for the facet. Empty for any other
 *  type, which is how the picker knows not to offer the control. */
export const noseShapes = (list: Component[]): string[] =>
  [...new Set(list.filter((p) => p.type === 'nosecone').map((p) => p.shape))].sort((a, b) => a.localeCompare(b));

/** The outer-diameter span of a list, in meters, or null for an empty list. */
export function odBounds(list: Component[]): { min: number; max: number } | null {
  if (list.length === 0) return null;
  const ds = list.map((p) => (p.type === 'parachute' ? p.diameter : p.outerDiameter));
  return { min: Math.min(...ds), max: Math.max(...ds) };
}

/**
 * Units and the words that join two of them.
 *
 * Anchored on a preceding digit, space or start of segment rather than on a
 * plain word boundary. That is what lets it strip the `mm` in `1.15"/29mm`,
 * where no boundary sits between a digit and a letter, while still leaving `MMT`
 * alone: there the trailing `\b` fails, because `MMT` is one word. `len` is
 * protected inside `lines` the same way. Both of those are signal worth keeping,
 * `MMT` saying motor mount tube rather than airframe.
 */
const UNIT_WORDS =
  /(?<=[\d\s]|^)(?:mm|cm|m|in|inch|inches|ft|len|length|long|dia|diameter|od|id|thick|thickness|wide|width|to|x|by)\b/gi;
/** Numbers, separators and the inch/foot marks. */
const FIGURES = /[\d.,/\-–×"'()\s]+/g;

/**
 * Whether a comma segment carries nothing but a measurement. Strip the unit
 * words, then the figures; a segment that had only those leaves nothing behind.
 * Written as a subtraction rather than as one pattern to match, because the
 * shapes are open-ended (`1.15"/29mm`, `12" len`, `29mm to 38mm`, `.25"`) and
 * a pattern that tries to enumerate them misses one every time.
 */
function isDimensional(s: string): boolean {
  return s.replace(UNIT_WORDS, ' ').replace(FIGURES, ' ').trim() === '';
}

/** The words a type's own name contributes, which the dialog heading already says. */
const TYPE_WORDS: Record<ComponentType, RegExp> = {
  bodytube: /^body\s*tubes?$/i,
  nosecone: /^nose\s*cones?$/i,
  parachute: /^parachutes?$/i,
  tubecoupler: /^(tube\s*)?couplers?$/i,
  centeringring: /^centering\s*rings?$/i,
  bulkhead: /^bulk\s*heads?$/i,
};

/**
 * The part of `desc` worth reading, once the columns are carrying the numbers.
 *
 * The catalog's descriptions are comma-separated and mostly restate the
 * geometry: "Blue Tube, 1.15"/29mm, MMT, 12" len" repeats an outer diameter the
 * row already shows, a bore it shows too, and a length in the next column over.
 * What is ONLY in the prose is the trade name ("Blue Tube") and the role
 * ("MMT", a motor mount tube rather than an airframe), and those are what people
 * actually search by. So three rules, each dropping a kind of duplicate:
 *
 *   1. segments that are nothing but a measurement
 *   2. a leading segment that just names the component type
 *   3. a `PN xxx` segment repeating the part number
 *
 * Everything else is kept verbatim, because the catalog is 15 manufacturers'
 * free text and anything cleverer would be guessing.
 */
export function describeNotes(p: Component): string {
  const typeWords = TYPE_WORDS[p.type];
  // Compared with the punctuation stripped, because a catalog writes the same
  // part number both ways: unhyphenated in the part-number field and hyphenated
  // after a `PN` in the prose, which an exact comparison lets straight through
  // into a column sitting right next to the first copy.
  //
  // Split on commas as well, because 417 rows put two identifiers in the one
  // field (`BNC-20R, 70240`, `SBT-705, 030329`) and the description's `PN` names
  // only one of them. Comparing against the whole field missed every one.
  const bare = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const pns = p.partNo.split(',').map(bare).filter(Boolean);
  // A nose cone's shape has a column of its own, so the word in the description
  // is the same duplication as a diameter, just spelled rather than measured.
  const shape = p.type === 'nosecone' ? p.shape.toLowerCase() : null;
  return p.desc
    .split(',')
    .map((seg) => seg.trim())
    .filter((seg, i) => {
      if (!seg) return false;
      if (isDimensional(seg)) return false;
      if (i === 0 && typeWords.test(seg)) return false;
      if (pns.length > 0 && /^p\/?n[\s:]/i.test(seg)) {
        // The segment may join two codes with a slash (`PN 30400/30408`) where the
        // part-number field lists them with a comma, so each piece is checked.
        // What is NOT dropped is a `PN` naming an identifier the part-number
        // column does not carry: 90 rows do that, and it is the one thing in the
        // segment that is real information rather than a repeat.
        const pieces = seg
          .replace(/^p\/?n[\s:]*/i, '')
          .split('/')
          .map(bare)
          .filter(Boolean);
        if (pieces.length > 0 && pieces.every((piece) => pns.includes(piece))) return false;
      }
      if (shape && seg.toLowerCase() === shape) return false;
      return true;
    })
    .join(' · ');
}
