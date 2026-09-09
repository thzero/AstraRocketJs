import type { ComponentNode } from '../../engine/openRocketEngine';
import { num } from '../../tree/nodeProps';
import { clusterOffsets } from '../../tree/cluster.js';
import { tubeFinRadius } from '../../tree/tubefins.js';
import { DISPLAY_NAME } from '../../tree/schema.js';
import { assemblyChainLength, isAssembly, resolveAssemblyRadius, ringInstanceOffsets } from '../../tree/assembly.js';
import { axialStart, finTabFront, profilePath, type Ctx } from './schematicGeometry';

const fillOf = (n: ComponentNode, dflt: string): string =>
  typeof n['color'] === 'string' ? (n['color'] as string) : dflt;

/**
 * One drawn instance of a fin set in the side view. `p` is the foreshortening
 * on the radial coordinates: cos(clock angle), so +1 is straight up, 0 edge-on,
 * −1 straight down (the desktop's FinSetShapes.getShapesSide, 24.12). `near` is
 * the half a flat silhouette can't express: a fin at +z is in FRONT of the
 * airframe (drawn whole); one at −z is behind (the tube covers its root, so its
 * fill is clipped at the wall).
 */
interface FinInstance {
  p: number;
  near: boolean;
}

/** Everything the airframe-shape render helpers close over — the memoized
 *  layout (chain/ctx/scale/w/h), the interaction state and callbacks, and the
 *  view state (roll, hover, motors) they read while drawing. */
export interface SchematicShapesCfg {
  chain: ComponentNode[];
  ctx: Ctx;
  scale: number;
  w: number;
  h: number;
  roll: number;
  /** Unique id namespace for this instance's clipPaths (two schematics can
   *  share one document — an unqualified id would cross-clip). */
  uid: string;
  motors?: Record<string, { length: number; diameter: number; label?: string }>;
  vertical?: boolean;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  setHoverId: React.Dispatch<React.SetStateAction<string | null>>;
  hoverId: string | null;
  onPatchNode?: (id: string, patch: Partial<ComponentNode>) => void;
  beginDrag: (child: ComponentNode, parent: ComponentNode, pLen: number) => (e: React.PointerEvent) => void;
  dragMoved: React.MutableRefObject<boolean>;
  textUp: (x: number, y: number) => { transform?: string };
}

/**
 * Builds the airframe shapes for the 2D schematic — the axial nose→tail chain
 * plus every child (fins, tubes, protuberances, internal components), the loaded
 * motor cases, and the shoulder/inner-component overlay pass. Pure given `cfg`:
 * walks the tree and returns the SVG nodes plus the hovered component's box/tag.
 */
export function buildSchematicShapes(cfg: SchematicShapesCfg): {
  shapes: React.ReactNode[];
  overlay: React.ReactNode[];
  /** Wireframe fin outlines drawn while the view is rolled (paint after overlay). */
  wires: React.ReactNode[];
  /** clipPath defs for the airframe-band cuts (paint inside the svg's <defs>). */
  clipDefs: React.ReactNode[];
  hoverBox: { x0: number; y0: number; x1: number; y1: number } | null;
  hoverTag: { x: number; y: number; tw: number } | null;
  hoverName: string;
} {
  const {
    chain,
    ctx,
    scale,
    w,
    h,
    roll,
    uid,
    motors,
    vertical,
    selectedId,
    onSelect,
    setHoverId,
    hoverId,
    onPatchNode,
    beginDrag,
    dragMoved,
    textUp,
  } = cfg;

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
            if (!dragMoved.current) onSelect(n.id!);
          },
          style: { cursor: 'pointer' } as React.CSSProperties,
        }
      : {}),
  });
  const selStroke = (n: ComponentNode, dflt: string) => (isSel(n) ? 'var(--accent)' : dflt);
  const selWidth = (n: ComponentNode, dflt: number | string = 1) => (isSel(n) ? 2 : dflt);

  // --- render chain + children ---
  const shapes: React.ReactNode[] = [];
  // Dashed "shadow" shapes (inner components, shoulders) paint AFTER the whole
  // hull: SVG stacks by document order, so a coupler overhanging into the NEXT
  // tube used to vanish under that tube's opaque fill (while the overhang into
  // the PREVIOUS tube, already painted, stayed visible — Eric's ebay report).
  const overlay: React.ReactNode[] = [];
  // Wireframe fin outlines and their hit surfaces, painted after overlay: while
  // the view is rolled every fin becomes a plain outline over the body (desktop
  // OpenRocket's convention), so all N fins stay on screen and each can be
  // followed round the airframe.
  const wires: React.ReactNode[] = [];
  let key = 0;

  // ROLLED = WIREFRAME (fins only). At rest the drawing is filled — near fins
  // whole, far fins cut at the airframe wall. The moment the roll slider leaves
  // zero, every fin is drawn as a plain outline, over the body, nothing hidden.
  const wire = roll !== 0;

  // One clip per (centreline, body radius): everything OUTSIDE the airframe
  // band, as two rects. Cuts a FAR fin's fill at the tube wall (a fin behind the
  // body has its root hidden). Memoised so a shared band reuses one def.
  const clipDefs: React.ReactNode[] = [];
  const airframeClips = new Map<string, string>();
  const airframeClip = (baseY: number, pRadius: number): string => {
    const top = baseY - pRadius * ctx.scale;
    const bottom = baseY + pRadius * ctx.scale;
    const memo = `${top.toFixed(3)}:${bottom.toFixed(3)}`;
    const seen = airframeClips.get(memo);
    if (seen) return seen;
    const id = `${uid}-outside-${airframeClips.size}`;
    airframeClips.set(memo, id);
    const FAR = 1e4; // certainly covers the drawing; lives inside the view transform
    clipDefs.push(
      <clipPath key={id} id={id}>
        <rect x={-FAR} y={-FAR} width={2 * FAR} height={FAR + top} />
        <rect x={-FAR} y={bottom} width={2 * FAR} height={FAR} />
      </clipPath>,
    );
    return id;
  };

  /**
   * Where each fin of a set lands in the side view: a signed foreshortening
   * factor `p` on its radial coordinates (+1 up, 0 edge-on, −1 down = cos θ,
   * the desktop's FinSetShapes), and `near` = whether it's in FRONT of the
   * airframe (sin θ ≥ 0). EVERY instance comes back, including hidden ones;
   * furthest-out last so the reaching fin reads on top when a rolled set overlaps.
   */
  const finFactors = (n: ComponentNode, dfltCount = 3): FinInstance[] => {
    const count = Math.max(1, Math.round(num(n, 'finCount', dfltCount)));
    const base = num(n, 'rotation', 0) + roll;
    const out: FinInstance[] = [];
    for (let i = 0; i < count; i++) {
      const a = base + (2 * Math.PI * i) / count;
      out.push({ p: Math.cos(a), near: Math.sin(a) >= 0 });
    }
    return out.sort((x, y) => Math.abs(x.p) - Math.abs(y.p));
  };

  // Ink for a fin drawn as a wireframe outline: the component's own colour, no fill.
  const wireInk = (n: ComponentNode, grab: Record<string, unknown>) => ({
    ...grab,
    fill: 'none',
    stroke: selStroke(n, fillOf(n, '#7a786f')),
    strokeWidth: selWidth(n, 1.4),
  });

  // One wire fin: the visible outline plus an INVISIBLE hit surface clipped to
  // OUTSIDE the airframe band, so a click on bare body tube doesn't land on a
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

  // Hover extent for a fin set: the union of what is actually DRAWN (tip and the
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

  // Hovered component's drawn extent (layout px), unioned across instances
  // (cluster copies, pod rings) as the shapes render.
  const hoverBoxes: { x0: number; y0: number; x1: number; y1: number }[] = [];
  let hoverName = '';
  const noteHover = (n: ComponentNode, x0: number, y0: number, x1: number, y1: number) => {
    if (!hoverId || n.id !== hoverId) return;
    hoverName = n.name ?? DISPLAY_NAME[n.type];
    hoverBoxes.push({
      x0: Math.min(x0, x1),
      y0: Math.min(y0, y1),
      x1: Math.max(x0, x1),
      y1: Math.max(y0, y1),
    });
  };

  // Loaded motor case (S5): launch-orange tint at the real case size, with
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
        stroke="#e0764a"
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
          fill="#ffffff"
          {...textUp(lx, cY)}
          style={{ pointerEvents: 'none' }}
        >
          {motor.label}
        </text>,
      );
    }
    return out;
  };

  const renderChildren = (parent: ComponentNode, pStart: number, pLen: number, pRadius: number, baseY: number) => {
    for (const child of parent.children ?? []) {
      const t = child.type;
      // Off-axis assembly: draw its whole chain once per ring instance at the
      // instance's projected baseline (side view projects y, ignores depth z).
      // The view roll turns the ring; −off.y since the section frame's +y is UP
      // and SVG y grows down.
      if (isAssembly(t)) {
        const podChain = child.children ?? [];
        const podLen = assemblyChainLength(child);
        const podRadius = resolveAssemblyRadius(child, pRadius);
        const podStart = axialStart(child, podLen, pStart, pLen);
        const count = Math.max(1, Math.round(num(child, 'instanceCount', 2)));
        for (const off of ringInstanceOffsets(count, podRadius, num(child, 'angleOffset', 0) + roll)) {
          renderChain(podChain, podStart, baseY - off.y * ctx.scale);
        }
        continue;
      }
      const grab = {
        ...clickable(child),
        ...(onPatchNode && child.id && !vertical
          ? {
              onPointerDown: beginDrag(child, parent, pLen),
              style: { cursor: 'grab' } as React.CSSProperties,
            }
          : {}),
      };
      // Through-the-wall fin tab: dashed rect from the body surface inward,
      // foreshortened with the fin instance `p` it belongs to.
      const renderTab = (finStart: number, finLen: number, p: number) => {
        const tabH = Math.min(num(child, 'tabHeight', 0), pRadius);
        const tabLen = num(child, 'tabLength', 0);
        if (tabH <= 0 || tabLen <= 0) return;
        const front = finStart + finTabFront(child, finLen);
        const yInner = baseY - (pRadius - tabH) * p * ctx.scale;
        const ySurface = baseY - pRadius * p * ctx.scale;
        const hPx = Math.abs(yInner - ySurface);
        if (wire && hPx < 0.5) return;
        (wire ? wires : shapes).push(
          <rect
            key={key++}
            x={ctx.x0 + front * ctx.scale}
            y={Math.min(yInner, ySurface)}
            width={Math.max(2, tabLen * ctx.scale)}
            height={wire ? hPx : Math.max(1.5, hPx)}
            fill={wire ? 'none' : fillOf(child, '#b9b7b0')}
            fillOpacity={wire ? undefined : '0.35'}
            stroke="#7a786f"
            strokeWidth="1"
            strokeDasharray="3 2"
            style={{ pointerEvents: 'none' }}
          />,
        );
      };
      if (t === 'freeformfinset') {
        const raw = (child['points'] as [number, number][] | undefined) ?? [];
        if (raw.length >= 3) {
          const chord = Math.max(...raw.map((p) => p[0]));
          const start = axialStart(child, chord, pStart, pLen);
          const ymax = Math.max(0, ...raw.map((p) => p[1]));
          const reach = pRadius + ymax;
          const projections = finFactors(child);
          noteHoverFins(
            child,
            ctx.x0 + start * ctx.scale,
            ctx.x0 + (start + chord) * ctx.scale,
            baseY,
            reach,
            pRadius,
            projections,
          );
          const clip = airframeClip(baseY, pRadius);
          for (const { p, near } of projections) {
            const ptsStr = raw
              .map(([px, py]) => `${ctx.x0 + (start + px) * ctx.scale},${baseY - (pRadius + py) * p * ctx.scale}`)
              .join(' ');
            // Rolled: an outline over the body — every instance, including one
            // lying flat inside the airframe (the one you follow round).
            if (wire) {
              pushWire(child, grab, clip, (extra) => <polygon key={key++} points={ptsStr} {...extra} />);
              renderTab(start, chord, p);
              continue;
            }
            const body = (
              <polygon
                key={key++}
                points={ptsStr}
                clipPath={near ? undefined : `url(#${clip})`}
                fill={fillOf(child, '#b9b7b0')}
                stroke={selStroke(child, '#7a786f')}
                strokeWidth={selWidth(child)}
                {...grab}
              />
            );
            // Only fins that poke past the airframe are drawn: an edge-on blade
            // (reach·|p| ≤ pRadius) is hidden behind the body, not a bar down
            // the centreline. Near ones go in the overlay (on top); far ones
            // under the hull, their root cut at the wall by the clip.
            if (reach * Math.abs(p) > pRadius) {
              (near ? overlay : shapes).push(body);
              renderTab(start, chord, p);
            }
          }
        }
      } else if (t === 'trapezoidfinset' || t === 'ellipticalfinset') {
        const root = num(child, 'rootChord', 0.05);
        const tip = t === 'trapezoidfinset' ? num(child, 'tipChord', root * 0.6) : 0;
        const sweep = t === 'trapezoidfinset' ? num(child, 'sweep', 0.02) : root / 2;
        const height = num(child, 'height', 0.03);
        const start = axialStart(child, root, pStart, pLen);
        const reach = pRadius + height;
        const projections = finFactors(child);
        noteHoverFins(
          child,
          ctx.x0 + start * ctx.scale,
          ctx.x0 + (start + Math.max(root, sweep + tip)) * ctx.scale,
          baseY,
          reach,
          pRadius,
          projections,
        );
        const finClip = airframeClip(baseY, pRadius);
        for (const { p, near } of projections) {
          // A point at radius r projects to y = baseY − r·cos θ (angle 0 = up);
          // both the root (r = pRadius) and the tip (r = reach) scale by `p`.
          const y0 = baseY - pRadius * p * ctx.scale;
          const yh = baseY - reach * p * ctx.scale;
          const X = ctx.x0 + start * ctx.scale;
          const ry = Math.abs(y0 - yh);
          // Elliptical fin = a true half-ellipse by SVG arc (a quadratic Bézier
          // only reaches ~57% of its control height). ry unfloored while wired
          // so an edge-on ellipse degenerates to the line the other shapes draw.
          const ellipse = `M ${X} ${y0} A ${(root / 2) * ctx.scale} ${wire ? ry : Math.max(2, ry)} 0 0 ${p > 0 ? 1 : 0} ${X + root * ctx.scale} ${y0} Z`;
          const trap = `${X},${y0} ${X + sweep * ctx.scale},${yh} ${X + (sweep + tip) * ctx.scale},${yh} ${X + root * ctx.scale},${y0}`;
          if (wire) {
            pushWire(child, grab, finClip, (extra) =>
              t === 'trapezoidfinset' ? (
                <polygon key={key++} points={trap} {...extra} />
              ) : (
                <path key={key++} d={ellipse} {...extra} />
              ),
            );
            renderTab(start, root, p);
            continue;
          }
          const outsideClip = near ? undefined : `url(#${finClip})`;
          const body =
            t === 'trapezoidfinset' ? (
              <polygon
                key={key++}
                clipPath={outsideClip}
                points={trap}
                fill={fillOf(child, '#b9b7b0')}
                stroke={selStroke(child, '#7a786f')}
                strokeWidth={selWidth(child)}
                {...grab}
              />
            ) : (
              <path
                key={key++}
                clipPath={outsideClip}
                d={ellipse}
                fill={fillOf(child, '#b9b7b0')}
                stroke={selStroke(child, '#7a786f')}
                strokeWidth={selWidth(child)}
                {...grab}
              />
            );
          if (reach * Math.abs(p) > pRadius) {
            (near ? overlay : shapes).push(body);
            renderTab(start, root, p);
          }
        }
      } else if (t === 'tubefinset') {
        // Side view: every tube of the ring at its projected height. A tube runs
        // PARALLEL to the axis, so roll doesn't squash its 2·rt silhouette — only
        // its centre moves, to (pRadius + rt)·cos θ. Tubes whose silhouette falls
        // entirely inside the airframe are hidden behind it and dropped.
        const len = num(child, 'length', 0.1);
        const rt = tubeFinRadius(child, pRadius);
        const start = axialStart(child, len, pStart, pLen);
        const X = ctx.x0 + start * ctx.scale;
        noteHover(
          child,
          X,
          baseY - (pRadius + 2 * rt) * ctx.scale,
          X + len * ctx.scale,
          baseY + (pRadius + 2 * rt) * ctx.scale,
        );
        const tubes = finFactors(child, 6);
        const tubeClip = airframeClip(baseY, pRadius);
        for (const { p, near } of tubes) {
          const yc = baseY - (pRadius + rt) * p * ctx.scale;
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
                stroke="#7a786f"
                strokeWidth="0.8"
                strokeDasharray="4 3"
                style={{ pointerEvents: 'none' }}
              />,
            );
            continue;
          }
          const cut = near ? undefined : `url(#${tubeClip})`;
          if ((pRadius + rt) * Math.abs(p) + rt > pRadius) {
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
                fill={fillOf(child, '#c8c5be')}
                fillOpacity="0.6"
                stroke={selStroke(child, '#7a786f')}
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
                stroke="#7a786f"
                strokeWidth="0.8"
                strokeDasharray="4 3"
                style={{ pointerEvents: 'none' }}
              />,
            );
          }
        }
      } else if (t === 'fairing') {
        // External shroud: SOLID outline (it's on the outside — Eric's spec),
        // drawn on the top surface; radial angle isn't modeled.
        const len = num(child, 'length', 0.08);
        const hgt = num(child, 'height', 0.02);
        const fshape = String(child['fairingShape'] ?? 'halfround');
        const start = axialStart(child, len, pStart, pLen);
        const X = ctx.x0 + start * ctx.scale;
        const y0 = baseY - pRadius * ctx.scale;
        const yh = y0 - hgt * ctx.scale;
        const Xe = X + len * ctx.scale;
        noteHover(child, X, yh, Xe, y0);
        shapes.push(
          fshape === 'streamlined' ? (
            <polygon
              key={key++}
              points={`${X},${y0} ${X + 0.3 * len * ctx.scale},${yh} ${X + 0.7 * len * ctx.scale},${yh} ${Xe},${y0}`}
              fill={fillOf(child, '#c8c5be')}
              stroke={selStroke(child, '#7a786f')}
              strokeWidth={selWidth(child)}
              {...grab}
            />
          ) : fshape === 'halfround' ? (
            <path
              key={key++}
              d={`M ${X} ${y0} L ${X} ${yh + 0.35 * (y0 - yh)} Q ${X} ${yh} ${X + Math.min(8, len * ctx.scale * 0.25)} ${yh} L ${Xe - Math.min(8, len * ctx.scale * 0.25)} ${yh} Q ${Xe} ${yh} ${Xe} ${yh + 0.35 * (y0 - yh)} L ${Xe} ${y0} Z`}
              fill={fillOf(child, '#c8c5be')}
              stroke={selStroke(child, '#7a786f')}
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
              fill={fillOf(child, '#c8c5be')}
              stroke={selStroke(child, '#7a786f')}
              strokeWidth={selWidth(child)}
              {...grab}
            />
          ),
        );
      } else if (t === 'launchlug' || t === 'railbutton') {
        // Rail buttons are edited via 'outerDiameter' (their only size field)
        // and have no axial 'length' — a button is about as long as it is wide.
        const btnDia = t === 'railbutton' ? num(child, 'outerDiameter', 0.004) : 0;
        const len = t === 'railbutton' ? btnDia : num(child, 'length', 0.01);
        const r = t === 'railbutton' ? btnDia / 2 : num(child, 'outerRadius', 0.002);
        const start = axialStart(child, len, pStart, pLen);
        // Project the radial mount angle onto the side profile: 0° stands at full
        // height above the tube, ±90° is edge-on (foreshortens away), 180° sits
        // below. Vertical offset = radius·cos(angle) (kernel default 180°).
        const c = Math.cos(num(child, 'angleOffset', Math.PI));
        const yInner = baseY - pRadius * c * ctx.scale;
        const yOuter = baseY - (pRadius + 2 * r) * c * ctx.scale;
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
            fill={fillOf(child, '#c8c5be')}
            stroke={selStroke(child, '#7a786f')}
            strokeWidth={selWidth(child)}
            {...grab}
          />,
        );
      } else {
        // Internal component: dashed outline inside the parent. A clustered
        // inner tube draws once per cluster position (side-view projection).
        // Per-type stroke color + a small tag differentiate what used to be
        // identical grey boxes (issue 2026-08-05a #21) — tubes/couplers stay
        // neutral (they really are tube segments), payload-type parts get
        // muted colors from the theme-safe midrange.
        const TYPE_STYLE: Partial<Record<string, { stroke: string; tag: string }>> = {
          parachute: { stroke: '#b06a35', tag: 'chute' },
          streamer: { stroke: '#a08c2e', tag: 'strmr' },
          shockcord: { stroke: '#8f7a8d', tag: 'cord' },
          masscomponent: { stroke: '#a85f5c', tag: 'mass' },
          centeringring: { stroke: '#6f8a5c', tag: 'CR' },
          bulkhead: { stroke: '#66748c', tag: 'BH' },
          engineblock: { stroke: '#7d7050', tag: 'EB' },
        };
        const style = TYPE_STYLE[child.type];
        const len = num(child, 'length', num(child, 'packedLength', 0.025));
        const r = Math.min(
          pRadius * 0.85,
          num(child, 'outerRadius', num(child, 'radius', num(child, 'packedRadius', pRadius * 0.7))),
        );
        const start = axialStart(child, len, pStart, pLen);
        const offsets =
          child.type === 'innertube'
            ? clusterOffsets(
                child['cluster'] as string | undefined,
                num(child, 'outerRadius', 0.0095),
                num(child, 'clusterScale', 1),
                num(child, 'clusterRotation', 0),
              )
            : [{ y: 0, z: 0 }];
        // Loaded motor: a brownish silhouette at the REAL case size, seated
        // flush against the mount's aft end (how motors actually load).
        const motor = child.type === 'innertube' && child.id ? motors?.[child.id] : undefined;
        for (const off of offsets) {
          const inkColor = isSel(child) ? 'var(--accent)' : fillOf(child, style?.stroke ?? '#9a978f');
          noteHover(
            child,
            ctx.x0 + start * ctx.scale,
            baseY + (off.y - r) * ctx.scale,
            ctx.x0 + (start + len) * ctx.scale,
            baseY + (off.y + r) * ctx.scale,
          );
          overlay.push(
            <rect
              key={key++}
              x={ctx.x0 + start * ctx.scale}
              y={baseY + (off.y - r) * ctx.scale}
              width={Math.max(2, len * ctx.scale)}
              height={2 * r * ctx.scale}
              fill={child.type === 'bulkhead' ? 'url(#bulkhead-hatch)' : 'rgba(127,127,127,0.001)'}
              stroke={inkColor}
              strokeWidth={selWidth(child)}
              strokeDasharray="3 2"
              {...grab}
            >
              <title>{child.name ?? DISPLAY_NAME[child.type]}</title>
            </rect>,
          );
          // Miniature glyphs (Eric's pick, 2026-08-05b #21): a picture inside
          // the box for chutes, mass items, centering rings and shock cords,
          // drawn whenever there's room; the text tag stays for the rest.
          const bw = len * ctx.scale;
          const bh = 2 * r * ctx.scale;
          const gcx = ctx.x0 + (start + len / 2) * ctx.scale;
          const gcy = baseY + off.y * ctx.scale;
          const gs = Math.min(bw * 0.8, bh * 0.7); // glyph box size
          if (gs >= 8) {
            const g = gs / 2;
            const glyphProps = {
              stroke: fillOf(child, style?.stroke ?? '#9a978f'),
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
                    fill={fillOf(child, style?.stroke ?? '#9a978f')}
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
          // Type tag, when the box has room for it — glyph types skip the
          // text once their picture is drawn. Counter-rotated tags read
          // horizontally in vertical mode, so the room roles swap.
          const hasGlyph = gs >= 8 && ['parachute', 'masscomponent', 'centeringring', 'shockcord'].includes(child.type);
          const tagRoom = vertical
            ? 2 * r * ctx.scale > 26 && len * ctx.scale > 11
            : len * ctx.scale > 26 && 2 * r * ctx.scale > 11;
          if (style && !hasGlyph && tagRoom) {
            const tx = ctx.x0 + (start + len / 2) * ctx.scale;
            const ty = baseY + off.y * ctx.scale;
            overlay.push(
              <text
                key={key++}
                x={tx}
                y={ty}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize="8.5"
                fill={fillOf(child, style.stroke)}
                {...textUp(tx, ty)}
                style={{ pointerEvents: 'none', textTransform: 'uppercase', letterSpacing: '0.04em' }}
              >
                {style.tag}
              </text>,
            );
          }
          if (motor) {
            overlay.push(
              ...motorShapes(
                motor,
                start + len - motor.length + num(child, 'motorOverhang', 0),
                baseY + off.y * ctx.scale,
              ),
            );
          }
        }
        renderChildren(child, start, len, r, baseY);
      }
    }
  };

  // Dashed outline for a shoulder sliding inside the adjacent tube. Painted in
  // the overlay pass — an aft shoulder lives inside the NEXT tube, which is
  // drawn later and would otherwise cover it.
  const shoulderRect = (startX: number, lenSi: number, rSi: number, color: string, baseY: number) => {
    if (lenSi <= 0 || rSi <= 0) return;
    overlay.push(
      <rect
        key={key++}
        x={ctx.x0 + startX * scale}
        y={baseY - rSi * scale}
        width={Math.max(1.5, lenSi * scale)}
        height={2 * rSi * scale}
        fill="rgba(127,127,127,0.001)"
        stroke={color}
        strokeWidth="1"
        strokeDasharray="3 2"
        style={{ pointerEvents: 'none' }}
      />,
    );
  };

  // Draws an axial nose→tail chain with its centerline at screen `baseY`
  // (ctx.cy for the core rocket; offset for each off-axis pod instance).
  const renderChain = (nodes: ComponentNode[], xStart: number, baseY: number) => {
    let cx = xStart;
    for (const n of nodes) {
      const len = num(n, 'length', 0);
      if (n.type === 'nosecone') {
        const r = num(n, 'aftRadius', 0.012);
        noteHover(n, ctx.x0 + cx * scale, baseY - r * scale, ctx.x0 + (cx + len) * scale, baseY + r * scale);
        shapes.push(
          <path
            key={key++}
            d={profilePath(ctx, n, cx, len, 0, r, baseY)}
            fill={fillOf(n, '#d5d2cb')}
            stroke={selStroke(n, '#7a786f')}
            strokeWidth={selWidth(n)}
            {...clickable(n)}
          />,
        );
        shoulderRect(cx + len, num(n, 'shoulderLength', 0), num(n, 'shoulderRadius', 0), '#9a978f', baseY);
        renderChildren(n, cx, len, r, baseY);
        cx += len;
      } else if (n.type === 'bodytube') {
        const r = num(n, 'outerRadius', 0.012);
        // A zero-size "phantom" tube (length 0, radius 0) is a modelling hack
        // used only to hang an off-axis fin set at a chosen radius (e.g. a
        // T-tail's horizontal stabiliser). Draw no rect for it — a degenerate
        // rect leaves a stray dot/line — but still lay out its children below.
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
              fill={fillOf(n, '#e7e5e0')}
              stroke={selStroke(n, '#7a786f')}
              strokeWidth={selWidth(n)}
              {...clickable(n)}
            />,
          );
        }
        // Min-diameter: a motor loaded directly in this body tube draws at its
        // real case size, seated flush against the tube's aft end.
        const tubeMotor = n.id ? motors?.[n.id] : undefined;
        if (tubeMotor) {
          shapes.push(...motorShapes(tubeMotor, cx + len - tubeMotor.length + num(n, 'motorOverhang', 0), baseY));
        }
        renderChildren(n, cx, len, r, baseY);
        cx += len;
      } else if (n.type === 'transition') {
        const rf = num(n, 'foreRadius', 0.012);
        const ra = num(n, 'aftRadius', 0.009);
        noteHover(
          n,
          ctx.x0 + cx * scale,
          baseY - Math.max(rf, ra) * scale,
          ctx.x0 + (cx + len) * scale,
          baseY + Math.max(rf, ra) * scale,
        );
        shapes.push(
          <path
            key={key++}
            d={profilePath(ctx, n, cx, len, rf, ra, baseY)}
            fill={fillOf(n, '#d5d2cb')}
            stroke={selStroke(n, '#7a786f')}
            strokeWidth={selWidth(n)}
            {...clickable(n)}
          />,
        );
        const fsl = num(n, 'foreShoulderLength', 0);
        shoulderRect(cx - fsl, fsl, num(n, 'foreShoulderRadius', 0), '#9a978f', baseY);
        shoulderRect(cx + len, num(n, 'aftShoulderLength', 0), num(n, 'aftShoulderRadius', 0), '#9a978f', baseY);
        renderChildren(n, cx, len, Math.max(rf, ra), baseY);
        cx += len;
      }
    }
  };

  renderChain(chain, 0, ctx.cy);

  // Hover overlay (S5): a light accent wash over the hovered component's
  // extent plus a name tag — deliberately fainter than the solid width-2
  // selection outline so the two stay distinguishable.
  const hoverBox = hoverBoxes.length
    ? hoverBoxes.reduce((a, b) => ({
        x0: Math.min(a.x0, b.x0),
        y0: Math.min(a.y0, b.y0),
        x1: Math.max(a.x1, b.x1),
        y1: Math.max(a.y1, b.y1),
      }))
    : null;
  let hoverTag: { x: number; y: number; tw: number } | null = null;
  if (hoverBox) {
    const tw = hoverName.length * 6.2 + 14;
    hoverTag = {
      x: Math.min(w - tw / 2 - 2, Math.max(tw / 2 + 2, (hoverBox.x0 + hoverBox.x1) / 2)),
      // Above the component unless that leaves the viewBox; then below.
      y: hoverBox.y0 - 22 >= 2 ? hoverBox.y0 - 13 : Math.min(h - 11, hoverBox.y1 + 13),
      tw,
    };
  }

  return { shapes, overlay, wires, clipDefs, hoverBox, hoverTag, hoverName };
}
