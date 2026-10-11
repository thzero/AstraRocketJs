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
import { finCutContour, finMountOf } from '../../src/tree/finPlanform';
import { solidFor } from '../../src/services/exports/rocketPrintExport';
import { componentToDxf } from '../../src/services/exports/dxfExport';

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
  'report side view': (tree) => round(rocketSideView(tree).body),
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
  '3D view': (tree, node) =>
    buildPieces(tree)
      .pieces.filter((p) => p.id === node.id)
      .map((p) => positions(p.geometry)),
};

/** A flag, the part it is toggled on, and the value it is toggled to. */
interface Flag {
  name: string;
  part: ComponentNode;
  on: Record<string, unknown>;
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

// The Filled checkbox leaves the wall thickness on the part, so each `filled`
// toggle keeps it: a reader that reads the thickness and ignores the flag must
// show up here as not reacting.
const FLAGS: Flag[] = [
  { name: 'flipped nose cone', part: NOSE, on: { flipped: true } },
  { name: 'filled nose cone', part: NOSE, on: { filled: true } },
  { name: 'filled transition', part: TRANSITION, on: { filled: true } },
  { name: 'filled body tube', part: TUBE, on: { filled: true } },
  { name: 'unclipped transition', part: TRANSITION, on: { clipped: false } },
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
  'filled nose cone / printable solid': 'printed as a solid of revolution, wall or not',
  'flipped nose cone / printable solid': 'the same part turned round; the printed file is the part itself',
  'flipped nose cone / report template': 'the same part turned round; its wrap template does not change',
  'filled nose cone / 3D view': 'drawn as its outer surface',
  'filled transition / printable solid': 'printed as a solid of revolution, wall or not',
  'filled transition / 3D view': 'drawn as its outer surface',
};

/**
 * Pairs known to ignore a flag they should honor. Finding IDs are numbered per
 * audit run, so each entry cites an ID in the current docs/AUDIT.md or states
 * its reason in words. The fix removes the line.
 */
const KNOWN: Record<string, string> = {};

/** A design holding the part where it sits in a real rocket. */
function design(part: ComponentNode): RocketTree {
  const nose = part.type === 'nosecone' ? part : { ...NOSE, id: 'nose' };
  const chain =
    part.type === 'nosecone'
      ? [nose, { ...TUBE, id: 'tube' }]
      : part.type === 'transition'
        ? [nose, { ...TUBE, id: 'tube', outerRadius: 0.015 }, part, { ...TUBE, id: 'tail' }]
        : [nose, part];
  return { components: [{ type: 'stage', id: 'stage', children: chain }] } as unknown as RocketTree;
}

describe('every shape flag reaches every reader', () => {
  for (const flag of FLAGS) {
    const off = flag.part;
    const on = { ...flag.part, ...flag.on } as ComponentNode;
    for (const [reader, read] of Object.entries(READERS)) {
      const pair = `${flag.name} / ${reader}`;
      // Listed as unaffected: the reader must still not react, or the reason
      // no longer holds. Listed as known: still ignored until the fix, which
      // removes the line. Otherwise the reader has to react.
      const expected = !(pair in UNAFFECTED || pair in KNOWN);
      it(`${pair}: ${expected ? 'reacts' : (UNAFFECTED[pair] ?? `ignored, ${KNOWN[pair]}`)}`, () => {
        const changed = JSON.stringify(read(design(off), off)) !== JSON.stringify(read(design(on), on));
        expect(changed).toBe(expected);
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

/** Every node of the design with the fin set, so a reader can find it by id. */
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
        .map((s) => (s.kind === 'fin' ? [s.from, s.to] : null)),
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
};

const FIN_FLAGS: Flag[] = [
  { name: 'fins on a flipped nose cone', part: { ...NOSE, children: [FIN] } as ComponentNode, on: { flipped: true } },
  {
    name: 'fins on an unclipped transition',
    part: { ...TRANSITION, children: [FIN] } as ComponentNode,
    on: { clipped: false },
  },
];

/** Fin pairs where the reader cannot see the flag, with why. */
const FIN_UNAFFECTED: Record<string, string> = {};

describe('every shape flag on the part a fin set stands on reaches every fin reader', () => {
  for (const flag of FIN_FLAGS) {
    const off = flag.part;
    const on = { ...flag.part, ...flag.on } as ComponentNode;
    for (const [reader, read] of Object.entries(FIN_READERS)) {
      const pair = `${flag.name} / ${reader}`;
      const expected = !(pair in FIN_UNAFFECTED);
      it(`${pair}: ${expected ? 'reacts' : FIN_UNAFFECTED[pair]}`, () => {
        const before = read(design(off), off);
        expect(before).not.toBeNull();
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
