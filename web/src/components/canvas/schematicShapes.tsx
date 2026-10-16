import type { ComponentNode } from '../../engine/openRocketEngine';
import {
  FREEFORM_FALLBACK,
  bodyRadiusAt,
  finMount,
  finPointsWithRoot,
  finRootChord,
  finSpan,
  finTabPoints,
  mountRadius,
  type FinParent,
} from '../../tree/finPlanform';
import { profileEnds } from '../../tree/shapeProfile';
import { countOf, num, str } from '../../tree/nodeProps';
import { KERNEL_DEFAULTS } from '../../tree/kernelDefaults.js';
import { railButtonSize } from './railButton';
import { lineInstances, placementOffsets } from '../../tree/placement';
import { tubeFinRadius } from '../../tree/tubefins.js';
import { DISPLAY_NAME } from '../../tree/schema.js';
import { motorSeatStart, partLength } from '../../tree/position.js';
import { DISC_TYPES } from '../../services/files/componentFormats.js';
import { discDims, tubeRadii } from '../../services/design/discGeometry.js';
import {
  assemblyChainLength,
  assemblyParentRadius,
  isAssembly,
  resolveAssemblyRadius,
  ringInstanceOffsets,
} from '../../tree/assembly.js';
import { token } from '../common/colorTokens';
import { chainWithKernelEnds } from '../../services/design/autoRadius.js';
import {
  axialStart,
  colorOf,
  innerTubeExtent,
  internalExtent,
  profilePath,
  unionBox,
  type Ctx,
  type HoverBox,
} from '../../tree/schematicGeometry';

// The one shared override rule (schematicGeometry.colorOf), under a local name.
const fillOf = colorOf;

/**
 * One drawn instance of a fin set in the side view. `p` is the foreshortening
 * on the radial coordinates: cos(clock angle), so +1 is straight up, 0 edge-on,
 * −1 straight down (the desktop's FinSetShapes.getShapesSide, 24.12). `near` is
 * the half a flat silhouette can't express: a fin at +z is in front of the
 * airframe (drawn whole); one at −z is behind (the tube covers its root, so its
 * fill is clipped at the wall).
 */
interface FinInstance {
  p: number;
  near: boolean;
}

/** Everything the airframe-shape render helpers close over: the memoized
 *  layout (chain/ctx/scale/w/h), the interaction state and callbacks, and the
 *  view state (roll, motors) they read while drawing. Hover is not an input:
 *  the cfg carries only its writer, `setHoverId`. */
export interface SchematicShapesCfg {
  chain: ComponentNode[];
  ctx: Ctx;
  scale: number;
  w: number;
  h: number;
  roll: number;
  /** Unique id namespace for this instance's clipPaths (two schematics can
   *  share one document, and an unqualified id would cross-clip). */
  uid: string;
  motors?: Record<string, { length: number; diameter: number; label?: string }>;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  setHoverId: React.Dispatch<React.SetStateAction<string | null>>;
  /** Display name for an unnamed part (the tree panel's translated type name).
   *  Absent = the untranslated schema label. */
  partName?: (n: ComponentNode) => string;
  /** The short in-drawing tag for an internal part type (`schematic.tag.<type>`).
   *  Absent = the untranslated English tag. */
  typeTag?: (type: string) => string;
}

/** What the scene knows about one component's drawn footprint, keyed by node
 *  id: its extent (unioned across cluster copies and pod rings) and the name
 *  its hover tag prints. Built once per scene; the hovered id is resolved
 *  against it outside the scene memo, so hover never rebuilds the drawing. */
export type HoverExtents = Map<string, { box: HoverBox; name: string }>;

/**
 * Builds the airframe shapes for the 2D schematic: the axial nose→tail chain
 * plus every child (fins, tubes, protuberances, internal components), the loaded
 * motor cases, and the shoulder/inner-component overlay pass. Pure given `cfg`:
 * walks the tree and returns the SVG nodes plus every part's hover extent.
 */
export function buildSchematicShapes(cfg: SchematicShapesCfg): {
  shapes: React.ReactNode[];
  overlay: React.ReactNode[];
  /** Wireframe fin outlines drawn while the view is rolled (paint after overlay). */
  wires: React.ReactNode[];
  /** clipPath defs for the airframe-band cuts (paint inside the svg's <defs>). */
  clipDefs: React.ReactNode[];
  /** Every drawn component's extent and display name, for the hover overlay. */
  extents: HoverExtents;
} {
  const { ctx, scale, roll, uid, motors, selectedId, onSelect, setHoverId } = cfg;
  // A transition end with no radius on record is drawn as the kernel resolves it.
  const chain = chainWithKernelEnds(cfg.chain);
  const nameOf = (n: ComponentNode): string => n.name ?? cfg.partName?.(n) ?? DISPLAY_NAME[n.type];

  // Selection sync: click any drawn component to select it in the tree; the
  // selected component draws with an accent outline.
  const isSel = (n: ComponentNode) => !!selectedId && n.id === selectedId;
  const clickable = (n: ComponentNode) => ({
    ...(n.id
      ? {
          onPointerEnter: () => setHoverId(n.id!),
          onPointerLeave: () => setHoverId((cur) => (cur === n.id ? null : cur)),
        }
      : {}),
    ...(onSelect && n.id
      ? {
          onClick: (e: React.MouseEvent) => {
            e.stopPropagation();
            onSelect(n.id!);
          },
          style: { cursor: 'pointer' } as React.CSSProperties,
        }
      : {}),
  });
  const selStroke = (n: ComponentNode, dflt: string) => (isSel(n) ? 'var(--accent)' : dflt);
  const selWidth = (n: ComponentNode, dflt: number | string = 1) => (isSel(n) ? 2 : dflt);

  // --- render chain + children ---
  const shapes: React.ReactNode[] = [];
  // Dashed "shadow" shapes (inner components, shoulders) paint after the whole
  // hull: SVG stacks by document order, so a coupler overhanging into the next
  // tube would vanish under that tube's opaque fill, while its overhang into the
  // previous tube, already painted, stayed visible.
  const overlay: React.ReactNode[] = [];
  // Wireframe fin outlines and their hit surfaces, painted after overlay: while
  // the view is rolled every fin becomes a plain outline over the body (desktop
  // OpenRocket's convention), so all N fins stay on screen and each can be
  // followed around the airframe.
  const wires: React.ReactNode[] = [];
  let key = 0;

  // rolled = wireframe (fins only). At rest the drawing is filled: near fins
  // whole, far fins cut at the airframe wall. The moment the roll slider leaves
  // zero, every fin is drawn as a plain outline, over the body, nothing hidden.
  const wire = roll !== 0;

  // One clip per (centerline, body radius): everything outside the airframe
  // band, as two rects. Cuts a far fin's fill at the tube wall (a fin behind the
  // body has its root hidden). Memoized so a shared band reuses one def.
  const clipDefs: React.ReactNode[] = [];
  const FAR = 1e4; // certainly covers the drawing; lives inside the view transform
  const airframeClips = new Map<string, string>();
  const airframeClip = (baseY: number, pRadius: number): string => {
    const top = baseY - pRadius * ctx.scale;
    const bottom = baseY + pRadius * ctx.scale;
    const memo = `${top.toFixed(3)}:${bottom.toFixed(3)}`;
    const seen = airframeClips.get(memo);
    if (seen) return seen;
    const id = `${uid}-outside-${airframeClips.size}`;
    airframeClips.set(memo, id);
    clipDefs.push(
      <clipPath key={id} id={id}>
        <rect x={-FAR} y={-FAR} width={2 * FAR} height={FAR + top} />
        <rect x={-FAR} y={bottom} width={2 * FAR} height={FAR} />
      </clipPath>,
    );
    return id;
  };

  /**
   * The clip a far child of `parent` is cut with at the parent's wall. A body
   * tube's wall is one radius, so it is the band above; a nose cone's or a
   * transition's is its own profile, so the clip is everything outside that
   * outline, and a fin root running down a taper is hidden where the body
   * covers it.
   */
  const profileClips = new Map<string, string>();
  const wallClip = (parent: ComponentNode, pStart: number, pLen: number, pRadius: number, baseY: number): string => {
    if (parent.type !== 'nosecone' && parent.type !== 'transition') return airframeClip(baseY, pRadius);
    const { fore, aft } = profileEnds(parent);
    const outline = profilePath(ctx, parent, pStart, pLen, fore, aft, baseY);
    const seen = profileClips.get(outline);
    if (seen) return seen;
    const id = `${uid}-outside-profile-${profileClips.size}`;
    profileClips.set(outline, id);
    clipDefs.push(
      <clipPath key={id} id={id}>
        <path clipRule="evenodd" d={`M ${-FAR} ${-FAR} H ${FAR} V ${FAR} H ${-FAR} Z ${outline}`} />
      </clipPath>,
    );
    return id;
  };

  /**
   * Where each fin of a set lands in the side view: a signed foreshortening
   * factor `p` on its radial coordinates (+1 up, 0 edge-on, −1 down = cos θ,
   * the desktop's FinSetShapes), and `near` = whether it's in front of the
   * airframe (sin θ ≥ 0). every instance comes back, including hidden ones;
   * furthest-out last so the reaching fin reads on top when a rolled set overlaps.
   */
  const finFactors = (n: ComponentNode, dfltCount = 3): FinInstance[] => {
    const count = countOf(n, 'finCount', dfltCount);
    const out: FinInstance[] = ringInstanceOffsets(count, 1, num(n, 'rotation', 0) + roll).map(({ y, z }) => ({
      p: y,
      near: z >= 0,
    }));
    return out.sort((x, y) => Math.abs(x.p) - Math.abs(y.p));
  };

  // Ink for a fin drawn as a wireframe outline: the component's own color, no fill.
  const wireInk = (n: ComponentNode, grab: Record<string, unknown>) => ({
    ...grab,
    fill: 'none',
    stroke: selStroke(n, fillOf(n, token('sch-line'))),
    strokeWidth: selWidth(n, 1.4),
  });

  // One wire fin: the visible outline plus an invisible hit surface clipped to
  // outside the airframe band, so a click on bare body tube doesn't land on a
  // fin lying flat inside it.
  const pushWire = (
    n: ComponentNode,
    grab: Record<string, unknown>,
    clip: string,
    shape: (extra: Record<string, unknown>) => React.ReactNode,
  ) => {
    wires.push(shape(wireInk(n, grab)));
    wires.push(shape({ ...grab, fill: 'transparent', stroke: 'none', clipPath: `url(#${clip})` }));
  };

  // Hover extent for a fin set: the union of what is actually drawn (tip and the
  // airframe edge each instance emerges from), so a foreshortened set doesn't
  // wash empty sky beyond its shortened blades.
  const noteHoverFins = (
    n: ComponentNode,
    x0: number,
    x1: number,
    baseY: number,
    reach: number,
    pRadius: number,
    projections: FinInstance[],
  ) => {
    if (!projections.length) return;
    const ys = projections.flatMap(({ p, near }) => [
      baseY - reach * p * ctx.scale,
      baseY - pRadius * (near || wire ? p : Math.sign(p)) * ctx.scale,
    ]);
    noteHover(n, x0, Math.min(...ys), x1, Math.max(...ys));
  };

  // Every component's drawn extent (layout px), unioned across instances
  // (cluster copies, pod rings) as the shapes render. Recorded for all parts, not
  // just the hovered one: filtering on the hovered id makes that id an input of
  // the whole scene build, so every hover enter and leave rebuilds every shape.
  // A few dozen boxes per scene costs far less.
  const extents: HoverExtents = new Map();
  const noteHover = (n: ComponentNode, x0: number, y0: number, x1: number, y1: number) => {
    if (!n.id) return;
    const box: HoverBox = {
      x0: Math.min(x0, x1),
      y0: Math.min(y0, y1),
      x1: Math.max(x0, x1),
      y1: Math.max(y0, y1),
    };
    const prev = extents.get(n.id);
    extents.set(n.id, { box: prev ? unionBox(prev.box, box) : box, name: nameOf(n) });
  };

  // Loaded motor case: accent tint at the real case size, with
  // the designation printed in the case when it's long enough to carry it.
  const motorShapes = (
    motor: { length: number; diameter: number; label?: string },
    mStart: number,
    cY: number,
  ): React.ReactNode[] => {
    const mR = motor.diameter / 2;
    const out: React.ReactNode[] = [
      <rect
        key={key++}
        x={ctx.x0 + mStart * ctx.scale}
        y={cY - mR * ctx.scale}
        width={Math.max(2, motor.length * ctx.scale)}
        height={Math.max(2, 2 * mR * ctx.scale)}
        rx="1"
        fill="var(--launch)"
        fillOpacity="0.85"
        stroke={token('sch-motor-outline')}
        strokeWidth="0.8"
        style={{ pointerEvents: 'none' }}
      />,
    ];
    if (motor.label && motor.length * ctx.scale > 36) {
      const lx = ctx.x0 + (mStart + motor.length / 2) * ctx.scale;
      out.push(
        <text
          key={key++}
          x={lx}
          y={cY}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize="10"
          fontWeight="bold"
          fill={token('sch-label')}
          style={{ pointerEvents: 'none' }}
        >
          {motor.label}
        </text>,
      );
    }
    return out;
  };

  /**
   * Draws `parent`'s children. `pRadius` is the parent's largest radius, which
   * sizes the internal parts inside it; a part on the outside stands on the
   * body radius at its own station (`bodyRadiusAt`), which on a nose cone or
   * transition is not that radius.
   */
  const renderChildren = (parent: ComponentNode, pStart: number, pLen: number, pRadius: number, baseY: number) => {
    /** The parent's outer radius under the rocket-frame station `x`. */
    const surfaceAt = (x: number): number => bodyRadiusAt(parent, x - pStart) ?? pRadius;
    // A part the kernel repeats along the body is drawn once per copy.
    for (const child of (parent.children ?? []).flatMap(lineInstances)) {
      const t = child.type;
      // Off-axis assembly: draw its whole chain once per ring instance at the
      // instance's projected baseline (side view projects y, ignores depth z).
      // The view roll turns the ring; −off.y since the section frame's +y is up
      // and SVG y grows down.
      if (isAssembly(t)) {
        const podChain = child.children ?? [];
        const podLen = assemblyChainLength(child);
        const podRadius = resolveAssemblyRadius(child, assemblyParentRadius(parent));
        const podStart = axialStart(child, podLen, pStart, pLen);
        const count = countOf(child, 'instanceCount', 2);
        for (const off of ringInstanceOffsets(count, podRadius, num(child, 'angleOffset', 0) + roll)) {
          renderChain(podChain, podStart, baseY - off.y * ctx.scale);
        }
        continue;
      }
      const grab = {
        ...clickable(child),
      };
      // Through-the-wall fin tab, foreshortened with the fin instance `p` it
      // belongs to. `tab` is `finTabPoints` in the fin's own frame (x from the
      // fin front, y from the body radius `R` under it): down from the body
      // surface at its front edge, along its bottom, up to the surface at its
      // trailing edge. Its depth is clamped to the parent radius at its two
      // ends and its span stands where the kernel puts it, so the drawing and
      // the part the DXF, the STL and the 1:1 PDF template cut are one part.
      // On a body tube both ends sit on one radius and it is a rect; on a
      // nose cone or transition its top follows the surface.
      const renderTab = (finStart: number, R: number, tab: [number, number][] | null, p: number) => {
        if (!tab) return;
        const [front, bottomFront, , trail] = tab as [
          [number, number],
          [number, number],
          [number, number],
          [number, number],
        ];
        const px = (x: number) => ctx.x0 + (finStart + x) * ctx.scale;
        const py = (y: number) => baseY - (R + y) * p * ctx.scale;
        const ink = {
          fill: wire ? 'none' : fillOf(child, token('sch-part')),
          fillOpacity: wire ? undefined : '0.35',
          stroke: token('sch-line'),
          strokeWidth: '1',
          strokeDasharray: '3 2',
          style: { pointerEvents: 'none' } as React.CSSProperties,
        };
        const ys = [py(front[1]), py(bottomFront[1]), py(trail[1])];
        const hPx = Math.max(...ys) - Math.min(...ys);
        if (wire && hPx < 0.5) return;
        if (front[1] === trail[1]) {
          const yInner = py(bottomFront[1]);
          const ySurface = py(front[1]);
          (wire ? wires : shapes).push(
            <rect
              key={key++}
              x={px(front[0])}
              y={Math.min(yInner, ySurface)}
              width={Math.max(2, (trail[0] - front[0]) * ctx.scale)}
              height={wire ? hPx : Math.max(1.5, hPx)}
              {...ink}
            />,
          );
          return;
        }
        (wire ? wires : shapes).push(
          <polygon key={key++} points={tab.map(([x, y]) => `${px(x)},${py(y)}`).join(' ')} {...ink} />,
        );
      };
      if (t === 'freeformfinset' || t === 'trapezoidfinset' || t === 'ellipticalfinset') {
        // One branch for all three planar fin types. The outline, its root and
        // its tab come from tree/finPlanform, the module that owns them, rather
        // than from dimensions re-assembled here: the kernel's tip collapse (a
        // tip chord at or below 0.0001 m is a triangle), its root floor, its
        // 31-point ellipse and a root that runs along a tapered parent are all
        // applied there. At schematic scale the 31-point polygon and a smooth
        // arc are indistinguishable, and the polygon is what the 3D view, the
        // STL, the DXF and the PDF template draw, so the drawing is the part
        // that gets cut.
        //
        // The fin stands on the body radius under its own front
        // (`FinSet.getFinFront`), not on the parent's widest radius, and its
        // outline closes along the parent's profile (`getFinPointsWithRoot`).
        const fp: FinParent = finMount(child, parent, pStart) ?? pRadius;
        const R = mountRadius(fp) ?? pRadius;
        const outline = finPointsWithRoot(child, fp) ?? FREEFORM_FALLBACK;
        const tab = finTabPoints(child, fp);
        // The furthest-aft outline point (aftX) can sit behind the root when
        // the tip trailing corner overhangs; it only widens the drawn shape and
        // its hover/hit box, and does not move the fin.
        const chord = finRootChord(child);
        const aftX = Math.max(...outline.map((pt) => pt[0]));
        const start = typeof fp === 'number' ? axialStart(child, chord, pStart, pLen) : pStart + fp.front;
        const ymax = finSpan(child);
        const reach = R + ymax;
        const projections = finFactors(child);
        noteHoverFins(
          child,
          ctx.x0 + start * ctx.scale,
          ctx.x0 + (start + aftX) * ctx.scale,
          baseY,
          reach,
          R,
          projections,
        );
        const clip = wallClip(parent, pStart, pLen, pRadius, baseY);
        for (const { p, near } of projections) {
          const ptsStr = outline
            .map(([px, py]) => `${ctx.x0 + (start + px) * ctx.scale},${baseY - (R + py) * p * ctx.scale}`)
            .join(' ');
          // Rolled: an outline over the body, every instance, including one
          // lying flat inside the airframe (the one you follow round).
          if (wire) {
            pushWire(child, grab, clip, (extra) => <polygon key={key++} points={ptsStr} {...extra} />);
            renderTab(start, R, tab, p);
            continue;
          }
          const body = (
            <polygon
              key={key++}
              points={ptsStr}
              clipPath={near ? undefined : `url(#${clip})`}
              fill={fillOf(child, token('sch-part'))}
              stroke={selStroke(child, token('sch-line'))}
              strokeWidth={selWidth(child)}
              {...grab}
            />
          );
          // Only fins that poke past the airframe are drawn: an edge-on blade
          // (reach·|p| ≤ R) is hidden behind the body, not a bar down the
          // centerline. Near ones go in the overlay (on top); far ones under
          // the hull, their root cut at the wall by the clip.
          if (reach * Math.abs(p) > R) {
            (near ? overlay : shapes).push(body);
            renderTab(start, R, tab, p);
          }
        }
      } else if (t === 'tubefinset') {
        // Side view: every tube of the ring at its projected height. A tube runs
        // parallel to the axis, so roll doesn't squash its 2·rt silhouette; only
        // its center moves, to (R + rt)·cos θ. Tubes whose silhouette falls
        // entirely inside the airframe are hidden behind it and dropped. The
        // ring stands on the body radius R at its own front
        // (`TubeFinSet.getBodyRadius`), which sizes an automatic tube too.
        const len = num(child, 'length', KERNEL_DEFAULTS.tubefinset.length);
        const start = axialStart(child, len, pStart, pLen);
        const R = surfaceAt(start);
        const rt = tubeFinRadius(child, R);
        const X = ctx.x0 + start * ctx.scale;
        noteHover(child, X, baseY - (R + 2 * rt) * ctx.scale, X + len * ctx.scale, baseY + (R + 2 * rt) * ctx.scale);
        const tubes = finFactors(child, 6);
        const tubeClip = wallClip(parent, pStart, pLen, pRadius, baseY);
        for (const { p, near } of tubes) {
          const yc = baseY - (R + rt) * p * ctx.scale;
          const half = rt * ctx.scale;
          const w2 = Math.max(2, len * ctx.scale);
          if (wire) {
            pushWire(child, grab, tubeClip, (extra) => (
              <rect key={key++} x={X} y={yc - half} width={w2} height={2 * half} rx="2" {...extra} />
            ));
            wires.push(
              <line
                key={key++}
                x1={X}
                y1={yc}
                x2={X + len * ctx.scale}
                y2={yc}
                stroke={token('sch-line')}
                strokeWidth="0.8"
                strokeDasharray="4 3"
                style={{ pointerEvents: 'none' }}
              />,
            );
            continue;
          }
          const cut = near ? undefined : `url(#${tubeClip})`;
          if ((R + rt) * Math.abs(p) + rt > R) {
            const into = near ? overlay : shapes;
            into.push(
              <rect
                key={key++}
                x={X}
                y={yc - half}
                clipPath={cut}
                width={w2}
                height={2 * half}
                rx="2"
                fill={fillOf(child, token('sch-part-light'))}
                fillOpacity="0.6"
                stroke={selStroke(child, token('sch-line'))}
                strokeWidth={selWidth(child)}
                {...grab}
              />,
              <line
                key={key++}
                x1={X}
                y1={yc}
                x2={X + len * ctx.scale}
                y2={yc}
                clipPath={cut}
                stroke={token('sch-line')}
                strokeWidth="0.8"
                strokeDasharray="4 3"
                style={{ pointerEvents: 'none' }}
              />,
            );
          }
        }
      } else if (t === 'fairing') {
        // External shroud: solid outline (it's on the outside),
        // drawn on the top surface; radial angle isn't modeled.
        const len = num(child, 'length', KERNEL_DEFAULTS.fairing.length);
        const hgt = num(child, 'height', KERNEL_DEFAULTS.fairing.height);
        const fshape = str(child, 'fairingShape', 'halfround');
        const start = axialStart(child, len, pStart, pLen);
        const X = ctx.x0 + start * ctx.scale;
        const y0 = baseY - surfaceAt(start) * ctx.scale;
        const yh = y0 - hgt * ctx.scale;
        const Xe = X + len * ctx.scale;
        noteHover(child, X, yh, Xe, y0);
        shapes.push(
          fshape === 'streamlined' ? (
            <polygon
              key={key++}
              points={`${X},${y0} ${X + 0.3 * len * ctx.scale},${yh} ${X + 0.7 * len * ctx.scale},${yh} ${Xe},${y0}`}
              fill={fillOf(child, token('sch-part-light'))}
              stroke={selStroke(child, token('sch-line'))}
              strokeWidth={selWidth(child)}
              {...grab}
            />
          ) : fshape === 'halfround' ? (
            <path
              key={key++}
              d={`M ${X} ${y0} L ${X} ${yh + 0.35 * (y0 - yh)} Q ${X} ${yh} ${X + Math.min(8, len * ctx.scale * 0.25)} ${yh} L ${Xe - Math.min(8, len * ctx.scale * 0.25)} ${yh} Q ${Xe} ${yh} ${Xe} ${yh + 0.35 * (y0 - yh)} L ${Xe} ${y0} Z`}
              fill={fillOf(child, token('sch-part-light'))}
              stroke={selStroke(child, token('sch-line'))}
              strokeWidth={selWidth(child)}
              {...grab}
            />
          ) : (
            <rect
              key={key++}
              x={X}
              y={yh}
              width={Math.max(2, len * ctx.scale)}
              height={Math.max(2, hgt * ctx.scale)}
              fill={fillOf(child, token('sch-part-light'))}
              stroke={selStroke(child, token('sch-line'))}
              strokeWidth={selWidth(child)}
              {...grab}
            />
          ),
        );
      } else if (t === 'launchlug' || t === 'railbutton') {
        // A rail button has no axial 'length': it is as long as it is wide
        // (its outer diameter) and stands out from the body by its height.
        // Both are the kernel's own when absent, so the drawn button is the
        // size of the simulated one.
        const btn = t === 'railbutton' ? railButtonSize(child) : null;
        // A lug with no size keys is the kernel's own (ComponentFactory, case
        // "launchlug"), the size the 3D view and the exporters already use.
        const len = btn ? btn.diameter : num(child, 'length', KERNEL_DEFAULTS.launchlug.length);
        const reach = btn ? btn.reach : 2 * num(child, 'outerRadius', KERNEL_DEFAULTS.launchlug.outerRadius);
        const start = axialStart(child, len, pStart, pLen);
        // Project the radial mount angle, turned by the view's roll as the fins
        // are, onto the side profile: 0° stands at full height above the tube,
        // ±90° is edge-on (foreshortens away), 180° sits below. Vertical
        // offset = radius·cos(angle) (kernel default 180°).
        // It stands on the body radius at its own station.
        const c = Math.cos(num(child, 'angleOffset', Math.PI) + roll);
        const R = surfaceAt(start);
        const yInner = baseY - R * c * ctx.scale;
        const yOuter = baseY - (R + reach) * c * ctx.scale;
        const yTop = Math.min(yInner, yOuter);
        const h = Math.max(1, Math.abs(yOuter - yInner));
        noteHover(child, ctx.x0 + start * ctx.scale, yTop, ctx.x0 + (start + len) * ctx.scale, yTop + h);
        shapes.push(
          <rect
            key={key++}
            x={ctx.x0 + start * ctx.scale}
            y={yTop}
            width={Math.max(2, len * ctx.scale)}
            height={h}
            fill={fillOf(child, token('sch-part-light'))}
            stroke={selStroke(child, token('sch-line'))}
            strokeWidth={selWidth(child)}
            {...grab}
          />,
        );
      } else {
        // Internal component: dashed outline inside the parent. A clustered
        // inner tube draws once per cluster position (side-view projection).
        // Per-type stroke color + a small tag, so these do not read as identical
        // gray boxes: payload-type parts get muted
        // colors from the theme-safe midrange.
        const TYPE_STYLE: Partial<Record<string, { stroke: string; tag: string }>> = {
          parachute: { stroke: token('sch-parachute'), tag: 'chute' },
          streamer: { stroke: token('sch-streamer'), tag: 'strmr' },
          shockcord: { stroke: token('sch-shockcord'), tag: 'cord' },
          masscomponent: { stroke: token('sch-masscomponent'), tag: 'mass' },
          centeringring: { stroke: token('sch-centeringring'), tag: 'CR' },
          bulkhead: { stroke: token('sch-bulkhead'), tag: 'BH' },
          engineblock: { stroke: token('sch-engineblock'), tag: 'EB' },
          // Couplers and inner tubes get their own ink too: left neutral they
          // are two unlabeled gray boxes told apart only by size, and size is
          // what the 85% cap distorts for the coupler.
          tubecoupler: { stroke: token('sch-tubecoupler'), tag: 'TC' },
          innertube: { stroke: token('sch-innertube'), tag: 'IT' },
        };
        const style = TYPE_STYLE[child.type];
        // A ring, coupler, bulkhead or engine block is sized the way the DXF cut
        // sheet and the printed solid size it: its own radii, else the bore of
        // the tube it sits in, with a ring's bore taken from the mount through
        // it. An inner tube is drawn at its own size, the one it flies at
        // (innerTubeExtent). Everything else keeps `internalExtent`, whose 85% cap is what
        // keeps a chute's invented fallback box off the tube wall - a real
        // dimension does not need protecting from itself, and a coupler hit
        // that cap every time, since filling the bore is what a coupler is.
        const disc = DISC_TYPES.has(child.type) ? discDims(child, tubeRadii(parent), parent.children ?? []) : null;
        const { length: len, radius: r } = disc
          ? { length: disc.length, radius: disc.outerR }
          : child.type === 'innertube'
            ? innerTubeExtent(child)
            : internalExtent(child, pRadius);
        const start = axialStart(child, len, pStart, pLen);
        // Off the axis where the kernel flies it: an inner tube at each cluster
        // place, anything else at its own radial position, turned by the view's
        // roll as the fins are.
        const offsets = placementOffsets(child, r).map(({ y, z }) => ({
          y: y * Math.cos(roll) - z * Math.sin(roll),
          z: y * Math.sin(roll) + z * Math.cos(roll),
        }));
        // Loaded motor: an accent-tinted case at the real case size, seated
        // flush against the mount's aft end (how motors actually load).
        const motor = child.type === 'innertube' && child.id ? motors?.[child.id] : undefined;
        for (const off of offsets) {
          const inkColor = isSel(child) ? 'var(--accent)' : fillOf(child, style?.stroke ?? token('sch-ink'));
          noteHover(
            child,
            ctx.x0 + start * ctx.scale,
            baseY - (off.y + r) * ctx.scale,
            ctx.x0 + (start + len) * ctx.scale,
            baseY - (off.y - r) * ctx.scale,
          );
          overlay.push(
            <rect
              key={key++}
              x={ctx.x0 + start * ctx.scale}
              y={baseY - (off.y + r) * ctx.scale}
              width={Math.max(2, len * ctx.scale)}
              height={2 * r * ctx.scale}
              fill={child.type === 'bulkhead' ? 'url(#bulkhead-hatch)' : 'rgba(127,127,127,0.001)'}
              stroke={inkColor}
              strokeWidth={selWidth(child)}
              strokeDasharray="3 2"
              {...grab}
            >
              <title>{nameOf(child)}</title>
            </rect>,
          );
          // Miniature glyphs: a picture inside
          // the box for chutes, mass items, centering rings and shock cords,
          // drawn whenever there's room; the text tag stays for the rest.
          const bw = len * ctx.scale;
          const bh = 2 * r * ctx.scale;
          const gcx = ctx.x0 + (start + len / 2) * ctx.scale;
          const gcy = baseY - off.y * ctx.scale;
          const gs = Math.min(bw * 0.8, bh * 0.7); // glyph box size
          if (gs >= 8) {
            const g = gs / 2;
            const glyphProps = {
              stroke: fillOf(child, style?.stroke ?? token('sch-ink')),
              fill: 'none',
              strokeWidth: 1.2,
              style: { pointerEvents: 'none' as const },
            };
            if (child.type === 'parachute') {
              overlay.push(
                <g key={key++} {...glyphProps}>
                  <path d={`M ${gcx - g} ${gcy} A ${g} ${g} 0 0 1 ${gcx + g} ${gcy}`} />
                  <path
                    d={`M ${gcx - g} ${gcy} L ${gcx} ${gcy + g} L ${gcx + g} ${gcy} M ${gcx - g * 0.45} ${gcy - g * 0.65} L ${gcx} ${gcy + g} M ${gcx + g * 0.45} ${gcy - g * 0.65} L ${gcx} ${gcy + g}`}
                  />
                </g>,
              );
            } else if (child.type === 'masscomponent') {
              overlay.push(
                <g key={key++} {...glyphProps}>
                  <rect
                    x={gcx - g * 0.7}
                    y={gcy - g * 0.35}
                    width={g * 1.4}
                    height={g * 1.05}
                    fill={fillOf(child, style?.stroke ?? token('sch-ink'))}
                    fillOpacity="0.35"
                  />
                  <path
                    d={`M ${gcx - g * 0.35} ${gcy - g * 0.35} A ${g * 0.4} ${g * 0.5} 0 0 1 ${gcx + g * 0.35} ${gcy - g * 0.35}`}
                  />
                </g>,
              );
            } else if (child.type === 'centeringring') {
              // Ring cross-section: material near the walls, bore in the middle.
              overlay.push(
                <g key={key++} {...glyphProps}>
                  <line
                    x1={gcx}
                    y1={gcy - bh / 2 + 1.5}
                    x2={gcx}
                    y2={gcy - bh * 0.16}
                    strokeWidth={Math.max(2, bw * 0.5)}
                  />
                  <line
                    x1={gcx}
                    y1={gcy + bh * 0.16}
                    x2={gcx}
                    y2={gcy + bh / 2 - 1.5}
                    strokeWidth={Math.max(2, bw * 0.5)}
                  />
                </g>,
              );
            } else if (child.type === 'shockcord') {
              const seg = gs / 4;
              overlay.push(
                <path
                  key={key++}
                  {...glyphProps}
                  d={`M ${gcx - g} ${gcy} ${[1, 2, 3, 4].map((i) => `L ${gcx - g + i * seg * 2 - seg} ${gcy + (i % 2 ? -1 : 1) * g * 0.45} L ${gcx - g + i * seg * 2} ${gcy}`).join(' ')}`}
                />,
              );
            }
          }
          // Type tag, when the box has room for it; glyph types skip the
          // text once their picture is drawn.
          const hasGlyph = gs >= 8 && ['parachute', 'masscomponent', 'centeringring', 'shockcord'].includes(child.type);
          const tagRoom = len * ctx.scale > 26 && 2 * r * ctx.scale > 11;
          if (style && !hasGlyph && tagRoom) {
            const tx = ctx.x0 + (start + len / 2) * ctx.scale;
            const ty = baseY - off.y * ctx.scale;
            overlay.push(
              <text
                key={key++}
                x={tx}
                y={ty}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize="8.5"
                fill={fillOf(child, style.stroke)}
                style={{ pointerEvents: 'none', textTransform: 'uppercase', letterSpacing: '0.04em' }}
              >
                {cfg.typeTag?.(child.type) ?? style.tag}
              </text>,
            );
          }
          if (motor) {
            overlay.push(
              ...motorShapes(motor, motorSeatStart(child, start, len, motor.length), baseY - off.y * ctx.scale),
            );
          }
        }
        renderChildren(child, start, len, r, baseY);
      }
    }
  };

  /**
   * Ink for a shoulder: the owning part's color (its override, else this steel
   * blue) rather than the gray the other dashed annotations share.
   *
   * A shoulder is a snug fit by definition - a 24 mm stub in a 26 mm tube - so
   * its box always falls within a pixel or two of the tube's own outline, and a
   * gray that close to the tube's stroke is in the DOM without being on screen.
   * Tying it to the part it belongs to also says whose shoulder it is, which
   * matters where two meet: a transition's fore shoulder and the nose cone's aft
   * shoulder can sit in the same tube.
   */
  const SHOULDER_INK = token('sch-shoulder');

  // Dashed outline for a shoulder sliding inside the adjacent tube. Painted in
  // the overlay pass: an aft shoulder lives inside the next tube, which is
  // drawn later and would otherwise cover it. Held to the radius of the end it
  // stands on, as the 3D model holds it (rocketPieces).
  const shoulderRect = (
    owner: ComponentNode,
    startX: number,
    lenSi: number,
    radiusSi: number,
    endRadiusSi: number,
    baseY: number,
  ) => {
    const rSi = Math.min(radiusSi, endRadiusSi);
    if (lenSi <= 0 || rSi <= 0) return;
    overlay.push(
      <rect
        key={key++}
        x={ctx.x0 + startX * scale}
        y={baseY - rSi * scale}
        width={Math.max(1.5, lenSi * scale)}
        height={2 * rSi * scale}
        fill="rgba(127,127,127,0.001)"
        stroke={isSel(owner) ? 'var(--accent)' : fillOf(owner, SHOULDER_INK)}
        strokeWidth={selWidth(owner)}
        strokeDasharray="3 2"
        style={{ pointerEvents: 'none' }}
      >
        <title>{nameOf(owner)}</title>
      </rect>,
    );
  };

  // A revolved part's outline from station `cx`, hoverable out to radius `r`.
  const profileShape = (
    n: ComponentNode,
    cx: number,
    len: number,
    fore: number,
    aft: number,
    r: number,
    baseY: number,
  ) => {
    noteHover(n, ctx.x0 + cx * scale, baseY - r * scale, ctx.x0 + (cx + len) * scale, baseY + r * scale);
    shapes.push(
      <path
        key={key++}
        d={profilePath(ctx, n, cx, len, fore, aft, baseY)}
        fill={fillOf(n, token('sch-shell'))}
        stroke={selStroke(n, token('sch-line'))}
        strokeWidth={selWidth(n)}
        {...clickable(n)}
      />,
    );
  };

  // Draws an axial nose→tail chain with its centerline at screen `baseY`
  // (ctx.cy for the core rocket; offset for each off-axis pod instance).
  const renderChain = (nodes: ComponentNode[], xStart: number, baseY: number) => {
    let cx = xStart;
    for (const n of nodes) {
      const len = partLength(n);
      if (n.type === 'nosecone') {
        const r = num(n, 'aftRadius', KERNEL_DEFAULTS.nosecone.aftRadius);
        // A flipped nose cone is a tail cone: its base, and the shoulder on it,
        // are at the fore end.
        const flipped = n['flipped'] === true;
        const ends = profileEnds(n);
        profileShape(n, cx, len, ends.fore, ends.aft, r, baseY);
        const shLen = num(n, 'shoulderLength', 0);
        const baseR = flipped ? ends.fore : ends.aft;
        shoulderRect(n, flipped ? cx - shLen : cx + len, shLen, num(n, 'shoulderRadius', 0), baseR, baseY);
        renderChildren(n, cx, len, r, baseY);
        cx += len;
      } else if (n.type === 'bodytube') {
        const r = num(n, 'outerRadius', KERNEL_DEFAULTS.bodytube.outerRadius);
        // A zero-size "phantom" tube (length 0, radius 0) is a modeling hack
        // used only to hang an off-axis fin set at a chosen radius (e.g. a
        // T-tail's horizontal stabilizer). Draw no rect for it (a degenerate
        // rect leaves a stray dot/line), but still lay out its children below.
        const degenerate = r < 1e-6 || len < 1e-6;
        if (!degenerate) {
          noteHover(n, ctx.x0 + cx * scale, baseY - r * scale, ctx.x0 + (cx + len) * scale, baseY + r * scale);
          shapes.push(
            <rect
              key={key++}
              x={ctx.x0 + cx * scale}
              y={baseY - r * scale}
              width={len * scale}
              height={2 * r * scale}
              fill={fillOf(n, token('sch-shell-light'))}
              stroke={selStroke(n, token('sch-line'))}
              strokeWidth={selWidth(n)}
              {...clickable(n)}
            />,
          );
        }
        // Min-diameter: a motor loaded directly in this body tube draws at its
        // real case size, seated flush against the tube's aft end.
        const tubeMotor = n.id ? motors?.[n.id] : undefined;
        if (tubeMotor) {
          shapes.push(...motorShapes(tubeMotor, motorSeatStart(n, cx, len, tubeMotor.length), baseY));
        }
        renderChildren(n, cx, len, r, baseY);
        cx += len;
      } else if (n.type === 'transition') {
        const { fore: rf, aft: ra } = profileEnds(n);
        profileShape(n, cx, len, rf, ra, Math.max(rf, ra), baseY);
        const fsl = num(n, 'foreShoulderLength', 0);
        shoulderRect(n, cx - fsl, fsl, num(n, 'foreShoulderRadius', 0), rf, baseY);
        shoulderRect(n, cx + len, num(n, 'aftShoulderLength', 0), num(n, 'aftShoulderRadius', 0), ra, baseY);
        renderChildren(n, cx, len, Math.max(rf, ra), baseY);
        cx += len;
      }
    }
  };

  renderChain(chain, 0, ctx.cy);

  return { shapes, overlay, wires, clipDefs, extents };
}
