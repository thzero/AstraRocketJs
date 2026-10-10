import { isValidElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { ComponentNode, RocketTree } from '../../src/engine/openRocketEngine';
import { buildSchematicShapes } from '../../src/components/canvas/schematicShapes';
import { buildPieces } from '../../src/components/canvas/rocketPieces';
import { solidForNode } from '../../src/services/exports/solidMesh';
import { rocketSideView } from '../../src/services/report/reportGeometry';
import { writeTemplatesSection } from '../../src/services/report/templatesSection';
import type { PdfPage } from '../../src/services/report/pdfPage';
import { stationRadius } from '../../src/tree/shapeProfile';

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

const FLAGS: Flag[] = [
  { name: 'flipped nose cone', part: NOSE, on: { flipped: true } },
  { name: 'filled nose cone', part: NOSE, on: { filled: true, thickness: undefined } },
  { name: 'filled transition', part: TRANSITION, on: { filled: true, thickness: undefined } },
  { name: 'filled body tube', part: TUBE, on: { filled: true, thickness: undefined } },
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
 * Pairs known to ignore a flag they should honor, each against its finding in
 * docs/AUDIT.md. The fix removes the line.
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
