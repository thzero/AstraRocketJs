import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { ComponentNode, RocketTree } from '../../src/engine/openRocketEngine';
import { buildSchematicShapes } from '../../src/components/canvas/schematicShapes';
import { buildPieces } from '../../src/components/canvas/rocketPieces';
import { buildAftScene } from '../../src/components/canvas/AftView';
import type { TFunction } from 'i18next';
import { solidForNode } from '../../src/services/exports/solidMesh';
import { rocketSideView } from '../../src/services/report/reportGeometry';
import { writeTemplatesSection } from '../../src/services/report/templatesSection';
import type { PdfPage } from '../../src/services/report/pdfPage';
import { stationRadius } from '../../src/tree/shapeProfile';
import { finCutContour, finMountOf, parentRadiusOf } from '../../src/tree/finPlanform';
import { boreAt, tubeRadii } from '../../src/services/design/discGeometry';
import { autoFinTab } from '../../src/services/design/finTabAuto';
import { stageParts } from '../../src/services/report/reportModel';
import { solidFor } from '../../src/services/exports/rocketPrintExport';
import { componentToDxf } from '../../src/services/exports/dxfExport';
import { exportRkt } from '../../src/services/files/rktExport';
import { syncDerived } from '../../src/services/design/treeEdit';

/**
 * Every flag that changes a part's shape, against every reader that draws,
 * meshes or measures that shape.
 *
 * A flag the kernel flies but a reader ignores is a part drawn, printed or
 * measured as a different part from the one that flies, and no test of the
 * reader on its own notices, because each was written for the cases its author
 * had in mind. Here each flag is toggled on a fixed part and each reader's
 * output compared: it has to change, or the pair is listed in `UNAFFECTED` with
 * the reason the reader cannot see it.
 *
 * The automatic-radius flags are not here: they change a stored number, which
 * every reader then reads, and geometryParity.kernel.test.ts checks that number
 * against the kernel.
 */

type Reader = (tree: RocketTree, node: ComponentNode) => unknown;

/** Numbers rounded to a micrometer, so float noise is not mistaken for a change. */
const round = (v: unknown): unknown =>
  typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : Array.isArray(v) ? v.map(round) : v;

/** The geometry-bearing props of a rendered SVG tree, in order. */
function svgProps(nodes: ReactNode[]): unknown[] {
  const out: unknown[] = [];
  const visit = (n: ReactNode) => {
    if (Array.isArray(n)) return n.forEach(visit);
    if (!isValidElement(n)) return;
    const props = n.props as Record<string, unknown>;
    for (const key of ['d', 'x', 'y', 'width', 'height', 'points', 'transform']) {
      if (key in props) out.push([key, props[key]]);
    }
    visit(props['children'] as ReactNode);
  };
  nodes.forEach(visit);
  return out;
}

/** Vertex positions of a mesh, rounded. */
const positions = (geo: THREE.BufferGeometry | null | undefined): unknown =>
  geo ? round(Array.from(geo.getAttribute('position').array)) : null;

/** A jsPDF stand-in that records each drawing call, so a template's outline can be compared. */
function recordingPage(): { page: PdfPage; calls: unknown[] } {
  const calls: unknown[] = [];
  const doc: unknown = new Proxy(
    {},
    {
      get: (_t, key) => {
        if (key === 'internal') return { pageSize: { getWidth: () => 210, getHeight: () => 297 } };
        if (key === 'splitTextToSize') return (s: string) => [s];
        if (key === 'getTextWidth') return () => 10;
        if (key === 'getFontSize') return () => 10;
        if (key === 'getLineHeightFactor') return () => 1.15;
        if (key === 'getNumberOfPages') return () => 1;
        return (...args: unknown[]) => {
          if (key !== 'text') calls.push([key, round(args)]);
          return doc;
        };
      },
    },
  );
  const page = {
    doc,
    t: (k: string) => k,
    units: {},
    opts: {},
    PW: 210,
    PH: 297,
    M: 10,
    CW: 190,
    BOTTOM: 280,
    y: 10,
    started: false,
  } as unknown as PdfPage;
  return { page, calls };
}

/** Every id in a design, depth first. */
const walkIds = (nodes: ComponentNode[]): string[] =>
  nodes.flatMap((n) => [String(n.id), ...walkIds(n.children ?? [])]);

const READERS: Record<string, Reader> = {
  'station radius': (_tree, node) =>
    [0, 0.25, 0.5, 0.75, 1].map((f) => round(stationRadius(node, f * (node['length'] as number)))),
  schematic: (tree) => {
    const chain = tree.components[0]!.children ?? [];
    const { shapes, overlay } = buildSchematicShapes({
      chain,
      ctx: { scale: 1000, cy: 200, x0: 0 },
      scale: 1000,
      w: 800,
      h: 400,
      roll: 0,
      uid: 't',
      setHoverId: () => {},
    });
    return round(svgProps([...shapes, ...overlay]));
  },
  'report side view': (tree) => {
    const { body, pods } = rocketSideView(tree);
    return round([body, pods]);
  },
  'report template': (tree, node) => {
    const { page, calls } = recordingPage();
    writeTemplatesSection(
      page,
      tree,
      [],
      node.type === 'nosecone' ? [node] : [],
      node.type === 'transition' ? [node] : [],
    );
    return calls;
  },
  'printable solid': (_tree, node) => positions(solidForNode(node)),
  // The print export's own entry point, which sizes a ring or bulkhead from the
  // part it sits in.
  'print export solid': (tree, node) => positions(solidFor(tree, node)),
  '3D view': (tree, node) =>
    buildPieces(tree)
      .pieces.filter((p) => p.id === node.id)
      .map((p) => positions(p.geometry)),
  'disc geometry': (_tree, node) => round([tubeRadii(node), boreAt(node, 'fore'), boreAt(node, 'aft')]),
  'PDF parts table': (tree, node) =>
    round(stageParts(tree.components[0]!, { componentInfo: () => ({ mass: 0 }) }).filter((r) => r.type === node.type)),
  'aft view': (tree) => round(buildAftScene(tree.components, undefined, ((k: string) => k) as unknown as TFunction)),
  // Every part of the design, so a ring cut to fit inside the flagged part is read too.
  DXF: (tree) => walkIds(tree.components).map((id) => componentToDxf(tree, id)),
  'RockSim export': (tree) => exportRkt('t', tree).xml,
};

/**
 * A flag, the part it is toggled on, and the value it is toggled to. `like`
 * names the single flag whose `UNAFFECTED` reasons hold for a combination too.
 * `reads` is the id of the part the readers measure, when the flag is set on
 * one part to change another; `inPod` puts the part in a pod set.
 */
interface Flag {
  name: string;
  part: ComponentNode;
  on: Record<string, unknown>;
  like?: string;
  reads?: string;
  inPod?: true;
}

const NOSE: ComponentNode = {
  type: 'nosecone',
  id: 'part',
  shape: 'ogive',
  length: 0.12,
  aftRadius: 0.025,
  thickness: 0.002,
} as unknown as ComponentNode;
const TRANSITION: ComponentNode = {
  type: 'transition',
  id: 'part',
  shape: 'ellipsoid',
  length: 0.06,
  foreRadius: 0.015,
  aftRadius: 0.025,
  thickness: 0.002,
} as unknown as ComponentNode;
const TUBE: ComponentNode = {
  type: 'bodytube',
  id: 'part',
  length: 0.3,
  outerRadius: 0.025,
  thickness: 0.001,
} as unknown as ComponentNode;

const RING: ComponentNode = {
  type: 'centeringring',
  id: 'ring',
  length: 0.003,
  outerRadiusAuto: true,
  innerRadius: 0.009,
  innerRadiusAuto: false,
  position: { method: 'top', offset: 0.1 },
} as unknown as ComponentNode;

// The Filled checkbox leaves the wall thickness on the part, so each `filled`
// toggle keeps it: a reader that reads the thickness and ignores the flag must
// show up here as not reacting.
const FLAGS: Flag[] = [
  { name: 'flipped nose cone', part: NOSE, on: { flipped: true } },
  { name: 'filled nose cone', part: NOSE, on: { filled: true } },
  { name: 'filled transition', part: TRANSITION, on: { filled: true } },
  { name: 'filled body tube', part: TUBE, on: { filled: true } },
  { name: 'unclipped transition', part: TRANSITION, on: { clipped: false } },
  // A centering ring sized to the bore (`RadiusRingComponent.getOuterRadius`
  // reads the parent's inner radius), which a filled tube does not have.
  {
    name: 'filled body tube holding a ring',
    part: { ...TUBE, children: [RING] } as ComponentNode,
    on: { filled: true },
    reads: 'ring',
  },
  // A shape parameter, on the one shape of each part that takes one here.
  { name: 'shape parameter on a nose cone', part: NOSE, on: { shapeParameter: 0.5 } },
  {
    name: 'shape parameter on a transition',
    part: { ...TRANSITION, shape: 'power', shapeParameter: 0.5 } as ComponentNode,
    on: { shapeParameter: 0.25 },
  },
  // The same flags on other shapes, so a reader that handles one shape only shows.
  {
    name: 'flipped conical nose cone',
    part: { ...NOSE, shape: 'conical' } as ComponentNode,
    on: { flipped: true },
    like: 'flipped nose cone',
  },
  {
    name: 'unclipped haack transition',
    part: { ...TRANSITION, shape: 'haack' } as ComponentNode,
    on: { clipped: false },
    like: 'unclipped transition',
  },
  // A flag on a part inside a pod set, which readers reach through the assembly.
  { name: 'flipped nose cone in a pod', part: NOSE, on: { flipped: true }, like: 'flipped nose cone', inPod: true },
  // One flag toggled with another already set: a reader that handles each
  // alone can still let one mask the other.
  {
    name: 'flipped filled nose cone',
    part: { ...NOSE, filled: true } as ComponentNode,
    on: { flipped: true },
    like: 'flipped nose cone',
  },
  {
    name: 'filled flipped nose cone',
    part: { ...NOSE, flipped: true } as ComponentNode,
    on: { filled: true },
    like: 'filled nose cone',
  },
  {
    name: 'unclipped filled transition',
    part: { ...TRANSITION, filled: true } as ComponentNode,
    on: { clipped: false },
    like: 'unclipped transition',
  },
  {
    name: 'filled unclipped transition',
    part: { ...TRANSITION, clipped: false } as ComponentNode,
    on: { filled: true },
    like: 'filled transition',
  },
];

/**
 * Pairs where the reader cannot see the flag, with why. A reader that only
 * draws the outside of a part is not affected by its wall.
 */
const UNAFFECTED: Record<string, string> = {
  'filled nose cone / station radius': 'outer radius only',
  'filled nose cone / report side view': 'outline only',
  'filled nose cone / report template': 'a wrap template is the outside surface',
  'filled nose cone / schematic': 'side outline only; walls are not drawn',
  'filled transition / station radius': 'outer radius only',
  'filled transition / report side view': 'outline only',
  'filled transition / report template': 'a wrap template is the outside surface',
  'filled transition / schematic': 'side outline only; walls are not drawn',
  'filled body tube / station radius': 'outer radius only',
  'filled body tube / report side view': 'outline only',
  'filled body tube / report template': 'the template section draws no body tubes',
  'filled body tube / schematic': 'side outline only; walls are not drawn',
  // The ring's own readers: its outline and its mesh, through the parts that
  // take a ring.
  'filled body tube holding a ring / printable solid': 'the per-part mesh lathes airframe parts and fins, not rings',
  'filled body tube holding a ring / disc geometry': "reads a tube's radii and bore, and a ring is not a tube",
  'filled body tube holding a ring / report side view': 'outline only',
  'filled body tube holding a ring / report template': 'the template section draws no rings',
  'filled nose cone / printable solid': 'printed as a solid of revolution, wall or not',
  'filled nose cone / print export solid': 'printed as a solid of revolution, wall or not',
  'flipped nose cone / print export solid': 'the same part turned round; the printed file is the part itself',
  'filled transition / print export solid': 'printed as a solid of revolution, wall or not',
  // Desktop's RockSim reader (BodyTubeHandler, TransitionHandler) has no
  // filled body tube and no clip flag, so the format carries neither.
  'filled body tube / RockSim export': 'RockSim has no filled body tube',
  'unclipped transition / RockSim export': 'RockSim has no clip flag',
  ...Object.fromEntries(
    ['shape parameter on a nose cone', 'shape parameter on a transition'].flatMap((flag) => [
      [`${flag} / disc geometry`, 'the ends and the wall, which the shape parameter does not change'],
      [`${flag} / PDF parts table`, 'lists the ends and the length, which the shape parameter does not change'],
      [
        `${flag} / aft view`,
        'drawn end on as an opaque disc at its largest radius, which the parameter does not change',
      ],
      [`${flag} / DXF`, 'a DXF cuts flat plate parts only (fins, rings, bulkheads), and this part is not one'],
    ]),
  ),
  'flipped nose cone / printable solid': 'the same part turned round; the printed file is the part itself',
  'flipped nose cone / report template': 'the same part turned round; its wrap template does not change',
  'filled transition / printable solid': 'printed as a solid of revolution, wall or not',
  'flipped nose cone / PDF parts table': 'lists the base radius and the length, which turning the part round keeps',
  'unclipped transition / disc geometry': 'the ends and the wall, which clipping does not change',
  'unclipped transition / PDF parts table': 'lists the ends and the length, which clipping does not change',
  'flipped filled nose cone / disc geometry': 'a filled part has no bore at either end',
  ...Object.fromEntries(
    ['flipped nose cone', 'filled nose cone', 'filled transition', 'filled body tube', 'unclipped transition'].flatMap(
      (flag) => [
        [`${flag} / aft view`, 'drawn end on as an opaque disc at its largest radius, which the flag does not change'],
        [`${flag} / DXF`, 'a DXF cuts flat plate parts only (fins, rings, bulkheads), and this part is not one'],
      ],
    ),
  ),
};

/**
 * Pairs known to ignore a flag they should honor. Each entry states its reason
 * in words; the value lands in the test title, so it carries no audit finding
 * ID. The fix removes the line.
 */
const KNOWN: Record<string, string> = {};

/** The part where it sits in a real rocket: its chain, nose first. */
function chainFor(part: ComponentNode, tag = ''): ComponentNode[] {
  const nose = part.type === 'nosecone' ? part : ({ ...NOSE, id: `nose${tag}` } as ComponentNode);
  return part.type === 'nosecone'
    ? [nose, { ...TUBE, id: `tube${tag}` } as ComponentNode]
    : part.type === 'transition'
      ? [
          nose,
          { ...TUBE, id: `tube${tag}`, outerRadius: 0.015 } as ComponentNode,
          part,
          { ...TUBE, id: `tail${tag}` } as ComponentNode,
        ]
      : [nose, part];
}

/**
 * A design holding the part where it sits in a real rocket, or, `inPod`, in
 * the chain of a pod set beside the main body tube.
 */
function design(part: ComponentNode, inPod = false): RocketTree {
  const chain = inPod
    ? [
        { ...NOSE, id: 'nose' },
        {
          ...TUBE,
          id: 'tube',
          children: [
            {
              type: 'podset',
              id: 'pod',
              instanceCount: 2,
              radiusOffset: 0.06,
              position: { method: 'top', offset: 0.05 },
              children: chainFor(part, '-pod'),
            },
          ],
        },
      ]
    : chainFor(part);
  // Synced as the app holds every design, so automatic radii follow the flag.
  return syncDerived({ components: [{ type: 'stage', id: 'stage', children: chain }] } as unknown as RocketTree);
}

/** The node a reader measures in a design: the flagged part, or the one `reads` names. */
const measured = (tree: RocketTree, flag: Flag, part: ComponentNode): ComponentNode =>
  flag.reads ? findIn(tree.components, flag.reads)! : part;

const findIn = (nodes: ComponentNode[], id: string): ComponentNode | undefined => {
  for (const n of nodes) {
    if (n.id === id) return n;
    const hit = findIn(n.children ?? [], id);
    if (hit) return hit;
  }
  return undefined;
};

describe('every shape flag reaches every reader', () => {
  for (const flag of FLAGS) {
    const off = flag.part;
    const on = { ...flag.part, ...flag.on } as ComponentNode;
    for (const [reader, read] of Object.entries(READERS)) {
      const pair = `${flag.name} / ${reader}`;
      const reason = UNAFFECTED[pair] ?? (flag.like ? UNAFFECTED[`${flag.like} / ${reader}`] : undefined);
      // Listed as unaffected: the reader must still not react, or the reason
      // no longer holds. Listed as known: still ignored until the fix, which
      // removes the line. Otherwise the reader has to react.
      const expected = reason === undefined && !(pair in KNOWN);
      it(`${pair}: ${expected ? 'reacts' : (reason ?? `ignored, ${KNOWN[pair]}`)}`, () => {
        const read2 = (part: ComponentNode) => {
          const tree = design(part, flag.inPod);
          return JSON.stringify(read(tree, measured(tree, flag, part)));
        };
        expect(read2(off) !== read2(on)).toBe(expected);
      });
    }
  }
});

/**
 * A fin set standing on the flagged part, against every reader that places,
 * draws or cuts a fin. A fin's root runs along its parent's profile and its tab
 * starts at the body surface (`FinSet.getRootPoints`, `getTabPoints`), so a
 * flag that changes the parent's profile changes the fin each reader outputs.
 *
 * The fin's tab is shallower than the body, so a reader that only clamps the
 * tab to the parent's radius, and otherwise cuts a flat root, does not react.
 */
const FIN: ComponentNode = {
  type: 'freeformfinset',
  id: 'fins',
  finCount: 3,
  thickness: 0.003,
  points: [
    [0, 0],
    [0.015, 0.02],
    [0.04, 0],
  ],
  tabHeight: 0.004,
  tabLength: 0.02,
  tabOffsetMethod: 'middle',
  tabOffset: 0,
  position: { method: 'top', offset: 0.01 },
} as unknown as ComponentNode;

/** The fin set's node in a design. */
const finIn = (tree: RocketTree): ComponentNode => {
  const walk = (nodes: ComponentNode[]): ComponentNode | undefined => {
    for (const n of nodes) {
      if (n.id === FIN.id) return n;
      const hit = walk(n.children ?? []);
      if (hit) return hit;
    }
    return undefined;
  };
  return walk(tree.components)!;
};

/** The 2D schematic of a design's first stage, at 1 px per mm. */
const schematicOf = (tree: RocketTree) =>
  buildSchematicShapes({
    chain: tree.components[0]!.children ?? [],
    ctx: { scale: 1000, cy: 200, x0: 0 },
    scale: 1000,
    w: 800,
    h: 400,
    roll: 0,
    uid: 't',
    setHoverId: () => {},
  });

/** The `points` of every polygon in a rendered SVG list: the fins and their tabs. */
const polygonPoints = (nodes: ReactNode[]): unknown[] =>
  nodes
    .filter((n): n is ReactElement<{ points: unknown }> => isValidElement(n) && n.type === 'polygon')
    .map((n) => n.props.points);

/**
 * Readers of one fin set: every reader that places, draws or cuts it, each
 * returning only that fin's geometry.
 */
const FIN_READERS: Record<string, Reader> = {
  'schematic fins': (tree) => {
    const { shapes, overlay, extents } = schematicOf(tree);
    return round([polygonPoints([...shapes, ...overlay]), extents.get(String(FIN.id))?.box]);
  },
  '3D view fins': (tree) =>
    buildPieces(tree)
      .pieces.filter((p) => p.id === FIN.id)
      .map((p) => positions(p.geometry)),
  'aft view fins': (tree) =>
    round(
      buildAftScene(tree.components, undefined, ((k: string) => k) as unknown as TFunction)
        .outer.filter((s) => s.key.startsWith(`${String(FIN.id)}:`))
        .map((s) => (s.kind === 'fin' ? [s.angle, s.from, s.to] : s.kind === 'poly' ? s.points : null)),
    ),
  'fin cut contour': (tree) => round(finCutContour(finIn(tree), finMountOf(tree, String(FIN.id)))),
  'fin printable solid': (tree) => positions(solidFor(tree, finIn(tree))),
  'fin DXF': (tree) => componentToDxf(tree, String(FIN.id)),
  'fin template': (tree) => {
    const { page, calls } = recordingPage();
    writeTemplatesSection(page, tree, [finIn(tree)], [], []);
    return calls;
  },
  'report side view fins': (tree) => round(rocketSideView(tree).fins),
  'fin tab limit': (tree) => round(parentRadiusOf(tree, String(FIN.id))),
  'fin tab auto': (tree) => round(autoFinTab(tree, String(FIN.id))),
  'fin parts table': (tree) =>
    round(stageParts(tree.components[0]!, { componentInfo: () => ({ mass: 0 }) }).filter((r) => r.type === FIN.type)),
};

const FIN_FLAGS: Flag[] = [
  { name: 'fins on a flipped nose cone', part: { ...NOSE, children: [FIN] } as ComponentNode, on: { flipped: true } },
  {
    name: 'fins on an unclipped transition',
    part: { ...TRANSITION, children: [FIN] } as ComponentNode,
    on: { clipped: false },
  },
  { name: 'fins on a filled nose cone', part: { ...NOSE, children: [FIN] } as ComponentNode, on: { filled: true } },
  {
    name: 'fins on a filled transition',
    part: { ...TRANSITION, children: [FIN] } as ComponentNode,
    on: { filled: true },
  },
  { name: 'fins on a filled body tube', part: { ...TUBE, children: [FIN] } as ComponentNode, on: { filled: true } },
  // A flag on the fin set itself: the cant turns each fin about the middle of
  // its root (`FinSet.getCantRotation`), and its root drops to stay on the body.
  {
    name: 'canted fins on a body tube',
    part: { ...TUBE, children: [FIN] } as ComponentNode,
    on: { children: [{ ...FIN, cant: 0.1 }] },
  },
  {
    name: 'canted fins on a nose cone',
    part: { ...NOSE, children: [FIN] } as ComponentNode,
    on: { children: [{ ...FIN, cant: -0.1 }] },
    like: 'canted fins on a body tube',
  },
  // One flag toggled with another already set on the parent.
  {
    name: 'fins on a flipped filled nose cone',
    part: { ...NOSE, filled: true, children: [FIN] } as ComponentNode,
    on: { flipped: true },
    like: 'fins on a flipped nose cone',
  },
  {
    name: 'fins on a filled flipped nose cone',
    part: { ...NOSE, flipped: true, children: [FIN] } as ComponentNode,
    on: { filled: true },
    like: 'fins on a filled nose cone',
  },
  {
    name: 'fins on an unclipped filled transition',
    part: { ...TRANSITION, filled: true, children: [FIN] } as ComponentNode,
    on: { clipped: false },
    like: 'fins on an unclipped transition',
  },
  {
    name: 'fins on a filled unclipped transition',
    part: { ...TRANSITION, clipped: false, children: [FIN] } as ComponentNode,
    on: { filled: true },
    like: 'fins on a filled transition',
  },
];

/**
 * A fin stands on its parent's outer surface (`FinSet.getRootPoints` reads
 * `SymmetricComponent.getRadius`), and its tab is cut at most as deep as the
 * outer radius (`getMaxTabHeight`), so filling the parent changes no fin.
 */
const FILL_REASON = 'a fin stands on the outer surface, which filling does not move';

/** Fin pairs where the reader cannot see the flag, with why. */
const FIN_UNAFFECTED: Record<string, string> = {
  ...Object.fromEntries(
    ['fins on a filled nose cone', 'fins on a filled transition', 'fins on a filled body tube'].flatMap((flag) =>
      Object.keys(FIN_READERS).map((reader) => [`${flag} / ${reader}`, FILL_REASON]),
    ),
  ),
  // `FreeformFinSet.getSpan` is the outline's height less a trailing point
  // below the root. This transition widens aft, clipped or not, so the trailing
  // point moved onto it stays above the root and under the outline's peak.
  'fins on an unclipped transition / fin parts table':
    'the trailing point stays above the root on a widening transition',
  // The tab's depth limit is the parent's radius at the tab's two ends
  // (`FinSet.getMaxTabHeight`), which the cant does not move.
  'canted fins on a body tube / fin tab limit': "the parent's radius at the tab ends, which the cant does not move",
  'canted fins on a body tube / fin tab auto': 'sized from the mount and its rings, which the cant does not move',
  'canted fins on a body tube / fin parts table': "lists the fin's dimensions, which the cant does not change",
};

/**
 * Fin pairs known to ignore a flag they should honor. Each entry states its
 * reason in words; the fix removes the line.
 */
const FIN_KNOWN: Record<string, string> = {};

describe('every shape flag on the part a fin set stands on reaches every fin reader', () => {
  for (const flag of FIN_FLAGS) {
    const off = flag.part;
    const on = { ...flag.part, ...flag.on } as ComponentNode;
    for (const [reader, read] of Object.entries(FIN_READERS)) {
      const pair = `${flag.name} / ${reader}`;
      const reason = FIN_UNAFFECTED[pair] ?? (flag.like ? FIN_UNAFFECTED[`${flag.like} / ${reader}`] : undefined);
      const known = FIN_KNOWN[pair] ?? (flag.like ? FIN_KNOWN[`${flag.like} / ${reader}`] : undefined);
      const expected = reason === undefined && known === undefined;
      it(`${pair}: ${expected ? 'reacts' : (reason ?? `ignored, ${known}`)}`, () => {
        const before = read(design(off), off);
        expect(before).not.toBeNull();
        expect(before).not.toEqual([]);
        const changed = JSON.stringify(before) !== JSON.stringify(read(design(on), on));
        expect(changed).toBe(expected);
      });
    }
  }
});

describe('a filled body tube has no bore', () => {
  /** The smallest distance of any vertex from the rocket axis (+X). */
  const minRadius = (geo: THREE.BufferGeometry | null | undefined): number => {
    const p = geo!.getAttribute('position');
    let min = Infinity;
    for (let i = 0; i < p.count; i++) min = Math.min(min, Math.hypot(p.getY(i), p.getZ(i)));
    return min;
  };
  const filled = { ...TUBE, filled: true } as ComponentNode;
  const bore = (TUBE['outerRadius'] as number) - (TUBE['thickness'] as number);
  const view = (part: ComponentNode) => buildPieces(design(part)).pieces.find((p) => p.id === part.id)?.geometry;

  it('prints as a solid rod, with the wall thickness still on the part', () => {
    expect(minRadius(solidForNode(TUBE))).toBeCloseTo(bore, 7);
    expect(minRadius(solidForNode(filled))).toBeCloseTo(0, 7);
  });

  it('draws in the 3D view as a solid rod', () => {
    expect(minRadius(view(TUBE))).toBeCloseTo(bore, 7);
    expect(minRadius(view(filled))).toBeCloseTo(0, 7);
  });
});
