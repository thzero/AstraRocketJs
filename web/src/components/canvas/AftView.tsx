import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { ComponentNode, RocketTree } from '../../engine/openRocketEngine';
import { countOf, num } from '../../tree/nodeProps';
import { KERNEL_RAILBUTTON_OUTER_DIAMETER } from '../../tree/kernelDefaults.js';
import { finSpan } from '../../tree/finPlanform.js';
import { clusterOffsets } from '../../tree/cluster.js';
import { tubeFinRadius } from '../../tree/tubefins.js';
import { isAssembly, resolveAssemblyRadius, ringInstanceOffsets } from '../../tree/assembly.js';
import { colorOf, ZOOM_IDENTITY, zoomAbout, type MotorDims } from './schematicGeometry';
import { useWheelZoom } from './useWheelZoom';

/**
 * Aft end view — the rocket seen from behind (down the +X axis). This is the
 * only place cluster layouts, pod rings and fin counts are visible as they
 * really are: the side views project everything onto one plane. Pure display,
 * no interaction (edit cluster layout/rotation/spacing in the motor dialog and
 * watch this update).
 *
 * Convention: +y right, +z up — matching the kernel's cross-section frame
 * (cluster offsets and pod ring offsets are already {y,z} in that frame).
 */

/** Wheel step and zoom ceiling; hoisted so the hook's options keep one identity. */
const WHEEL_ZOOM = { factor: 1.15, max: 12 };

type Shape =
  | {
      kind: 'circle';
      /** Stable React key: the node id (or type) plus the instance index, so a
       *  cluster copy or a ring instance keeps its element across re-renders. */
      key: string;
      y: number;
      z: number;
      r: number;
      fill: string;
      stroke: string;
      dash?: string;
      width?: number;
      title?: string;
    }
  | {
      kind: 'fin';
      key: string;
      y: number;
      z: number;
      angle: number;
      from: number;
      to: number;
      thick: number;
      fill: string;
      stroke: string;
      title?: string;
    };

/**
 * The aft scene as three painter's layers plus the radial extent that frames
 * them. Module scope, not a closure inside the memo: the walk is two
 * mutually recursive functions, and the compiler lint reads a closure that
 * calls itself as a missing memo dependency. Given the same tree, motors
 * and translator it returns the same drawing, which is what the memo keys on.
 */
function buildAftScene(
  components: ComponentNode[],
  motors: MotorDims | undefined,
  t: TFunction,
): { hulls: Shape[]; inner: Shape[]; outer: Shape[]; extent: number } {
  // Painter's layers: hulls (opaque, big→small), then internals, then externals.
  const hulls: Shape[] = [];
  const inner: Shape[] = [];
  const outer: Shape[] = [];
  let extent = 0.02;

  const reach = (y: number, z: number, r: number) => {
    extent = Math.max(extent, Math.hypot(y, z) + r);
  };
  // Unnamed parts read as the tree panel's translated type name, not a
  // hard-coded English word.
  const nameOf = (n: ComponentNode) => n.name ?? t(`part.${n.type}`);
  const keyOf = (n: ComponentNode, i: number) => `${n.id ?? n.type}:${i}`;
  const motorShape = (n: ComponentNode, i: number, y: number, z: number, diameter: number): Shape => ({
    kind: 'circle',
    key: `${n.id ?? n.type}:motor:${i}`,
    y,
    z,
    r: diameter / 2,
    fill: '#8b5a2b',
    stroke: '#6b4520',
    title: t('part.motor'),
  });

  // The entry point first, the per-child walk after it: function
  // declarations, so the mutual recursion reads top-down.
  function walkChain(nodes: ComponentNode[], cy: number, cz: number) {
    for (const n of nodes) {
      if (n.type === 'stage') {
        walkChain(n.children ?? [], cy, cz);
        continue;
      }
      const r = Math.max(num(n, 'outerRadius', 0), num(n, 'aftRadius', 0), num(n, 'foreRadius', 0));
      if (r <= 0) continue;
      hulls.push({
        kind: 'circle',
        key: keyOf(n, 0),
        y: cy,
        z: cz,
        r,
        fill: colorOf(n, '#e7e5e0'),
        stroke: '#7a786f',
        title: nameOf(n),
      });
      reach(cy, cz, r);
      // Body-tube mounts (minimum/sub-minimum builds) draw their motor too —
      // previously only inner tubes did.
      if (n.type === 'bodytube' && n['motorMount'] === true) {
        const motor = n.id ? motors?.[n.id] : undefined;
        if (motor) inner.push(motorShape(n, 0, cy, cz, motor.diameter));
      }
      walkChildren(n, r, cy, cz);
    }
  }

  function walkChildren(parent: ComponentNode, pRadius: number, cy: number, cz: number) {
    for (const child of parent.children ?? []) {
      const type = child.type;
      if (isAssembly(type)) {
        const podRadius = resolveAssemblyRadius(child, pRadius);
        const count = countOf(child, 'instanceCount', 2);
        // +π/2 so the ring's 0° reference is "straight up" — the same reference
        // the fin sets use here — matching the 3D view (see the lug note below).
        for (const off of ringInstanceOffsets(count, podRadius, Math.PI / 2 + num(child, 'angleOffset', 0))) {
          walkChain(child.children ?? [], cy + off.y, cz + off.z);
        }
      } else if (type === 'trapezoidfinset' || type === 'ellipticalfinset' || type === 'freeformfinset') {
        const count = countOf(child, 'finCount', 3);
        const span = finSpan(child);
        const thick = num(child, 'thickness', 0.003);
        for (let i = 0; i < count; i++) {
          // First fin straight up (desktop rear-view convention) plus the
          // set's own rotation about the body axis.
          const angle = Math.PI / 2 + num(child, 'rotation', 0) + (2 * Math.PI * i) / count;
          outer.push({
            kind: 'fin',
            key: keyOf(child, i),
            y: cy,
            z: cz,
            angle,
            from: pRadius,
            to: pRadius + span,
            thick,
            fill: colorOf(child, '#b9b7b0'),
            stroke: '#7a786f',
            title: `${nameOf(child)} ×${count}`,
          });
        }
        reach(cy, cz, pRadius + span);
      } else if (type === 'tubefinset') {
        const count = countOf(child, 'finCount', 6);
        const rt = tubeFinRadius(child, pRadius);
        for (let i = 0; i < count; i++) {
          const angle = Math.PI / 2 + num(child, 'rotation', 0) + (2 * Math.PI * i) / count;
          const d = pRadius + rt;
          outer.push({
            kind: 'circle',
            key: keyOf(child, i),
            y: cy + d * Math.cos(angle),
            z: cz + d * Math.sin(angle),
            r: rt,
            fill: 'none',
            stroke: '#7a786f',
            title: `${nameOf(child)} ×${count}`,
          });
        }
        reach(cy, cz, pRadius + 2 * rt);
      } else if (type === 'fairing') {
        // Shroud cross-section at the top (radial angle not modeled).
        const wid = num(child, 'width', 0.025);
        const hgt = num(child, 'height', 0.02);
        outer.push({
          kind: 'fin',
          key: keyOf(child, 0),
          y: cy,
          z: cz,
          angle: Math.PI / 2,
          from: pRadius,
          to: pRadius + hgt,
          thick: wid,
          fill: colorOf(child, '#c8c5be'),
          stroke: '#7a786f',
          title: nameOf(child),
        });
        reach(cy, cz, pRadius + hgt);
      } else if (type === 'launchlug' || type === 'railbutton') {
        // Kernel default (RailButton.java:61), so the aft view shows the
        // button that is actually simulated. Was 0.004.
        const r =
          type === 'railbutton'
            ? num(child, 'outerDiameter', KERNEL_RAILBUTTON_OUTER_DIAMETER) / 2
            : num(child, 'outerRadius', 0.002);
        // Radial mount angle (kernel default 180°). The +π/2 is the aft view's
        // "up = 0°" convention — the same offset the fin sets carry here — so a
        // lug clocks consistently with the fins and with the 3D view.
        const ang = Math.PI / 2 + num(child, 'angleOffset', Math.PI);
        const rad = pRadius + r;
        outer.push({
          kind: 'circle',
          key: keyOf(child, 0),
          y: cy + rad * Math.cos(ang),
          z: cz + rad * Math.sin(ang),
          r,
          fill: colorOf(child, '#c8c5be'),
          stroke: '#7a786f',
          title: nameOf(child),
        });
        reach(cy, cz, pRadius + 2 * r);
      } else if (type === 'innertube') {
        const r = num(child, 'outerRadius', 0.0095);
        const offs = clusterOffsets(
          child['cluster'] as string | undefined,
          r,
          num(child, 'clusterScale', 1),
          num(child, 'clusterRotation', 0),
        );
        const motor = child.id ? motors?.[child.id] : undefined;
        offs.forEach((raw, i) => {
          // Rotate the cluster +π/2 into the aft view's "up = 0°" frame (the fins'
          // reference), so a split cluster clocks like the fins and the 3D view.
          const off = { y: -raw.z, z: raw.y };
          inner.push({
            kind: 'circle',
            key: keyOf(child, i),
            y: cy + off.y,
            z: cz + off.z,
            r,
            fill: 'none',
            stroke: colorOf(child, '#9a978f'),
            dash: '3 2',
            title: nameOf(child),
          });
          if (motor) inner.push(motorShape(child, i, cy + off.y, cz + off.z, motor.diameter));
          reach(cy + off.y, cz + off.z, r);
        });
        walkChildren(child, r, cy, cz);
      } else if (type === 'tubecoupler' || type === 'centeringring' || type === 'engineblock' || type === 'bulkhead') {
        const r = Math.min(pRadius * 0.98, num(child, 'outerRadius', pRadius * 0.95));
        inner.push({
          kind: 'circle',
          key: keyOf(child, 0),
          y: cy,
          z: cz,
          r,
          fill: 'none',
          stroke: colorOf(child, '#9a978f'),
          dash: '2 3',
          title: nameOf(child),
        });
      }
      // parachute/streamer/shockcord/mass: no meaningful cross-section here.
    }
  }

  walkChain(components, 0, 0);

  // Big circles first so nested ones stay visible.
  hulls.sort((a, b) => (b.kind === 'circle' ? b.r : 0) - (a.kind === 'circle' ? a.r : 0));
  return { hulls, inner, outer, extent };
}

export function AftView({
  tree,
  motors,
  roll = 0,
  onRoll,
}: {
  tree: RocketTree;
  /** Loaded motor dimensions per mount node id (real case sizes). */
  motors?: MotorDims;
  /** Roll angle (radians) — spins the whole aft cross-section about the axis. */
  roll?: number;
  /** Horizontal drag on the view spins the roll (delta radians). */
  onRoll?: (deltaRadians: number) => void;
}) {
  const { t } = useTranslation();
  // Zoom/pan in viewBox (meter) coordinates — same pattern as TreeSchematic
  // (issue 2026-08-05b #13: "the user needs to be able to zoom the aft view").
  const [zoom, setZoom] = useState(ZOOM_IDENTITY);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const pan = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const rollDrag = useRef<number | null>(null); // last clientX while drag-rolling
  const zoomBy = (f: number) =>
    // About the viewBox origin — the rocket axis is always at (0,0) here.
    setZoom((z) => zoomAbout(z, 0, 0, Math.min(WHEEL_ZOOM.max, Math.max(1, z.k * f))));
  /**
   * The whole aft scene, rebuilt only when the DESIGN (or the language) changes.
   *
   * All of this - the hulls, the recursive walk, every cluster and fin
   * instance - ran in the render body, while `onPointerMove` drives `onRoll`
   * (a store write) on every pointer sample. Dragging to roll or wheel-zooming
   * therefore re-walked the entire component tree and rebuilt every Shape per
   * pointer event. `TreeSchematic` hit this exact problem and fixed it by
   * memoizing `buildSchematicShapes`, with a docblock explaining why; this
   * view never got the same treatment.
   *
   * Roll and zoom are applied by the SVG transform below, so neither is an
   * input here: the geometry is the same drawing turned around.
   */
  const { hulls, inner, outer, extent } = useMemo(
    () => buildAftScene(tree.components, motors, t),
    [tree.components, motors, t],
  );

  const E = extent * 1.12;
  const scale = 1; // viewBox is in meters — the SVG scales itself.
  const toSvg = (v: number) => v * scale;

  // Wheel zoom about the pointer (shared hook). The mapping closes over the
  // current extent; the hook reads it through a ref, so there is no render-time
  // ref write and no listener churn when the extent changes.
  const wheelToView = useCallback(
    (e: WheelEvent, rect: DOMRect) => ({
      px: -E + ((e.clientX - rect.left) / rect.width) * 2 * E,
      py: -E + ((e.clientY - rect.top) / rect.height) * 2 * E,
    }),
    [E],
  );
  useWheelZoom(svgRef, setZoom, wheelToView, WHEEL_ZOOM);

  const drawShape = (s: Shape) => {
    if (s.kind === 'circle') {
      return (
        <circle
          key={s.key}
          cx={toSvg(s.y)}
          cy={-toSvg(s.z)}
          r={toSvg(s.r)}
          fill={s.fill}
          fillOpacity={s.fill === '#8b5a2b' ? 0.45 : undefined}
          stroke={s.stroke}
          strokeWidth={E / 220}
          strokeDasharray={
            s.dash
              ? s.dash
                  .split(' ')
                  .map((d) => (Number(d) * E) / 110)
                  .join(' ')
              : undefined
          }
        >
          {s.title ? <title>{s.title}</title> : null}
        </circle>
      );
    }
    // Fin: a radial rectangle from `from` to `to` at `angle`, `thick` wide.
    const cos = Math.cos(s.angle);
    const sin = Math.sin(s.angle);
    const ny = -sin; // unit normal in the cross-section plane
    const nz = cos;
    const h = s.thick / 2;
    const pts = [
      [s.y + s.from * cos + ny * h, s.z + s.from * sin + nz * h],
      [s.y + s.to * cos + ny * h, s.z + s.to * sin + nz * h],
      [s.y + s.to * cos - ny * h, s.z + s.to * sin - nz * h],
      [s.y + s.from * cos - ny * h, s.z + s.from * sin - nz * h],
    ];
    return (
      <polygon
        key={s.key}
        points={pts.map(([y, z]) => `${toSvg(y!)},${-toSvg(z!)}`).join(' ')}
        fill={s.fill}
        stroke={s.stroke}
        strokeWidth={E / 220}
      >
        {s.title ? <title>{s.title}</title> : null}
      </polygon>
    );
  };

  const toView = (clientX: number, clientY: number) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      vx: -E + ((clientX - rect.left) / rect.width) * 2 * E,
      vy: -E + ((clientY - rect.top) / rect.height) * 2 * E,
    };
  };
  return (
    <div style={{ position: 'relative', height: '100%' }}>
      <svg
        ref={svgRef}
        viewBox={`${-E} ${-E} ${2 * E} ${2 * E}`}
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
          touchAction: 'none',
          cursor: zoom.k > 1 ? 'grab' : undefined,
        }}
        // role="group" (not "img"): "img" collapses the whole SVG into one
        // node and suppresses every per-part <title> inside, so a screen reader
        // would hear only the one aria-label and none of the parts. "group"
        // keeps the overall name yet still exposes the named parts within.
        role="group"
        aria-label={t('schematic.aftAria')}
        onPointerDown={(e) => {
          // Drag rotates the roll (primary); pan only when zoomed and no onRoll.
          if (onRoll) {
            rollDrag.current = e.clientX;
            (e.target as Element).setPointerCapture?.(e.pointerId);
            return;
          }
          if (zoom.k === 1) return;
          const { vx, vy } = toView(e.clientX, e.clientY);
          pan.current = { px: vx, py: vy, x: zoom.x, y: zoom.y };
          (e.target as Element).setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (rollDrag.current !== null && onRoll) {
            const width = svgRef.current?.getBoundingClientRect().width || 300;
            onRoll(((e.clientX - rollDrag.current) / width) * 2 * Math.PI);
            rollDrag.current = e.clientX;
            return;
          }
          // Capture the pan state NOW: setZoom's updater runs after this
          // handler returns, and a pointer-up in between nulls pan.current —
          // reading it inside the updater crashed the app (live report,
          // "Cannot read properties of null (reading 'x')").
          const p = pan.current;
          if (!p || !svgRef.current) return;
          const { vx, vy } = toView(e.clientX, e.clientY);
          setZoom((z) => ({ ...z, x: p.x + (vx - p.px), y: p.y + (vy - p.py) }));
        }}
        onPointerUp={() => {
          pan.current = null;
          rollDrag.current = null;
        }}
        onPointerLeave={() => {
          pan.current = null;
          rollDrag.current = null;
        }}
      >
        <g transform={`translate(${zoom.x} ${zoom.y}) scale(${zoom.k}) rotate(${(roll * 180) / Math.PI})`}>
          {hulls.map(drawShape)}
          {inner.map(drawShape)}
          {outer.map(drawShape)}
          {/* Center crosshair */}
          <line x1={-E * 0.05} y1={0} x2={E * 0.05} y2={0} stroke="#9a978f" strokeWidth={E / 300} />
          <line x1={0} y1={-E * 0.05} x2={0} y2={E * 0.05} stroke="#9a978f" strokeWidth={E / 300} />
        </g>
      </svg>
      <div className="schematic-controls">
        <button title={t('schematic.zoomIn')} aria-label={t('schematic.zoomIn')} onClick={() => zoomBy(1.5)}>
          +
        </button>
        <button title={t('schematic.zoomOut')} aria-label={t('schematic.zoomOut')} onClick={() => zoomBy(1 / 1.5)}>
          −
        </button>
        <button title={t('schematic.fit')} aria-label={t('schematic.fit')} onClick={() => setZoom(ZOOM_IDENTITY)}>
          ⤢
        </button>
      </div>
    </div>
  );
}
