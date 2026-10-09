import type { ComponentNode, RocketTree } from '../../../engine/openRocketEngine';

/**
 * Elements of a component that this app does not understand, carried through a
 * round trip verbatim.
 *
 * A `.ork` written by the desktop can hold things we have no model for, and they
 * sit at three levels: inside a component (the Appearance tab's `<appearance>`
 * and `<insideappearance>`), inside `<rocket>` (`<kitname>`), and beside it at
 * document level (`<photostudio>`, `<docprefs>`, `<datatypes>`). Reading them
 * into the app would mean building an editor for each; ignoring them would mean
 * every save silently throws them away, so a design that came here for one
 * dimension would go back stripped of its paint and its Photo Studio setup.
 *
 * So they are kept as raw XML on the node and written back where they were.
 * Nothing is parsed, nothing reaches the engine, and nothing can appear in the
 * property panel, because the key is not in the `FIELDS` table. The only rule
 * this has to obey is the one below: a tag we handle ourselves must never also be
 * carried, or the file would contain it twice.
 */

/**
 * Every direct child of a component element that our own reader or writer
 * handles. Anything not here is opaque and gets carried.
 *
 * Gathered from the selectors in `importTags.ts` / `importReaders.ts` and the
 * tags emitted by `exportParts.ts` / `exportWriters.ts`. A tag missing from this
 * set that we do write would be emitted twice, which the golden `.ork` snapshots
 * catch immediately - they are the drift guard, not a comment.
 */
export const KNOWN_COMPONENT_TAGS: ReadonlySet<string> = new Set([
  // Identity, notes, appearance-adjacent things we do model.
  'name',
  'id',
  'comment',
  'linestyle',
  'preset',
  'color',
  'finish',
  'material',
  'linematerial',
  'filletmaterial',
  // Placement.
  'position',
  'axialoffset',
  'angleoffset',
  'radiusoffset',
  'radialposition',
  'radialdirection',
  'instancecount',
  'instanceseparation',
  'rotation',
  // Structure.
  'subcomponents',
  'stage',
  'motormount',
  'deploymentconfiguration',
  'separationconfiguration',
  // Shape and dimensions.
  'shape',
  'shapeparameter',
  'shapeclipped',
  'length',
  'thickness',
  'radius',
  'innerradius',
  'outerradius',
  'innerdiameter',
  'outerdiameter',
  'diameter',
  'foreradius',
  'aftradius',
  'isflipped',
  'filled',
  // Shoulders.
  'foreshoulderradius',
  'foreshoulderlength',
  'foreshoulderthickness',
  'foreshouldercapped',
  'aftshoulderradius',
  'aftshoulderlength',
  'aftshoulderthickness',
  'aftshouldercapped',
  // Fins.
  'fincount',
  'rootchord',
  'tipchord',
  'sweeplength',
  'height',
  'cant',
  'crosssection',
  'finpoints',
  'point',
  'tabheight',
  'tablength',
  'tabposition',
  'filletradius',
  // Motor mounts and clusters.
  'clusterconfiguration',
  'clusterscale',
  'clusterrotation',
  'maxmotorlength',
  // Recovery and mass objects.
  'cd',
  'linecount',
  'linelength',
  'cordlength',
  'striplength',
  'stripwidth',
  'width',
  'spillholediameter',
  'packedlength',
  'packedradius',
  'deployevent',
  'deployaltitude',
  'deploydelay',
  'isdrogue',
  'mass',
  'masscomponenttype',
  // Rail buttons.
  'baseheight',
  'flangeheight',
  'screwheight',
  'nozzleexitdiameter',
  // Stage separation.
  'separationevent',
  'separationdelay',
  'separationaltitude',
  // Overrides.
  'overridemass',
  'overridecg',
  'overridecd',
  'overridesubcomponents',
  'overridesubcomponentsmass',
  'overridesubcomponentscg',
  'overridesubcomponentscd',
  // Our own RASAero extensions.
  'airfoilsection',
  'airfoillediamond',
  'airfoiltediamond',
  'finleradius',
  'caseairframe',
  'fairingshape',
  // Legacy aliases the reader accepts.
  'value',
]);

/**
 * Children of `<rocket>` that our own reader or writer handles.
 *
 * `referencetype` and `customreference` are here rather than carried because the
 * writer emits a `referencetype` of its own: carrying one as well would put the
 * element in the file twice. They are read and written explicitly instead, which
 * also keeps the writer off a hardcoded `maximum`, which would bring a design
 * whose stability calibers were measured against a custom length back measured
 * against its widest body tube.
 */
export const KNOWN_ROCKET_TAGS: ReadonlySet<string> = new Set([
  'name',
  'id',
  'comment',
  'designer',
  'revision',
  'designtype',
  'referencetype',
  'customreference',
  'motorconfiguration',
  'subcomponents',
  'axialoffset',
  'position',
]);

/**
 * Children of `<openrocket>` that our own reader or writer handles.
 *
 * Everything else at this level is a whole feature we do not have: `photostudio`
 * is the rendered-photograph setup, `docprefs` and `docmaterials` the design's
 * own preferences and material overrides, `datatypes` its custom expressions.
 * None of them is a component, so the component-level passthrough cannot reach
 * them.
 */
export const KNOWN_DOCUMENT_TAGS: ReadonlySet<string> = new Set(['rocket', 'simulations', 'designinfo']);

/**
 * Children of a `<simulation>` that our own reader or writer handles.
 *
 * The rest are desktop features with no counterpart here: `extension` (and the
 * older `listener` form) is a simulation extension such as air-start, roll
 * control or a script, `plotappearance` the plot styling, `landingdispersion`
 * the landing-scatter settings. None of them can run or be edited here, so they
 * are carried and written back between `<conditions>` and `<flightdata>`, where
 * desktop's saver puts them.
 */
export const KNOWN_SIMULATION_TAGS: ReadonlySet<string> = new Set([
  'name',
  'simulator',
  'calculator',
  'conditions',
  'flightdata',
]);

/** The node key the raw XML rides on. Not a `FIELDS` entry, so never editable. */
export const EXTRA_KEY = 'xmlExtra';

/** Where the `<rocket>`-level and document-level leftovers ride on the tree. */
export const ROCKET_EXTRA_KEY = 'xmlExtra';
export const DOC_EXTRA_KEY = 'docExtra';

/**
 * A decal names an image stored as a separate member of the `.ork` zip, and we
 * do not keep those members. Carrying the reference without the image would put
 * a dangling name in the file we write, so the reference is dropped and the rest
 * of the appearance - the paint, the shine, the opacity - is kept.
 */
const stripDecals = (el: Element): void => {
  el.querySelectorAll('decal').forEach((d) => d.remove());
};

/**
 * Read an element's unknown direct children, ready to be written back, or
 * `undefined` when it has none.
 *
 * Only direct children: anything nested inside an element we do handle is that
 * reader's business, and anything nested inside an element we do not is carried
 * along with its parent. `known` is the set for the level being read - a
 * component, `<rocket>`, or `<openrocket>` itself.
 *
 * What was dropped is not reported from here. The import note is built in
 * `orkImport` by asking the document itself, which needs no state threaded
 * through every reader to answer the same question.
 */
export function readPassthrough(el: Element, known: ReadonlySet<string> = KNOWN_COMPONENT_TAGS): string[] | undefined {
  const xml: string[] = [];
  const serializer = new XMLSerializer();
  for (const child of Array.from(el.children)) {
    if (known.has(child.tagName.toLowerCase())) continue;
    // Cloned before editing: the caller's document is still being read, and a
    // reader that runs after this one would otherwise see a modified tree.
    const copy = child.cloneNode(true) as Element;
    stripDecals(copy);
    xml.push(serializer.serializeToString(copy));
  }
  return xml.length ? xml : undefined;
}

/** The raw elements a node or tree is carrying under `key`, or an empty list. */
export function passthroughOf(holder: ComponentNode | RocketTree, key: string = EXTRA_KEY): string[] {
  const v = (holder as unknown as Record<string, unknown>)[key];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}
