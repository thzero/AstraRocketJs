import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { ComponentNode, RocketTree } from '../../engine/openRocketEngine';
import { anyOuterRadius, bodyTubeRadius, countOf, finCant, num } from '../../tree/nodeProps';
import { FIN_DEFAULTS, KERNEL_DEFAULTS } from '../../tree/kernelDefaults.js';
import { railButtonSize } from './railButton';
import {
  bodyRadiusAt,
  finBodyPoint,
  finMount,
  finOutlinePoints,
  finPointsWithRoot,
  finRootChord,
  finSpan,
  mountRadius,
  type FinPose,
} from '../../tree/finPlanform.js';
import { placementOffsets, turnedOffset } from '../../tree/placement';
import { isPlanarFinSet, tubeFinRadius } from '../../tree/tubefins.js';
import {
  assemblyChainLength,
  assemblyParentRadius,
  isAssembly,
  resolveAssemblyRadius,
  ringInstanceOffsets,
} from '../../tree/assembly.js';
import { isChainType } from '../../tree/componentKinds.js';
import { axialStart, partLength } from '../../tree/position.js';
import {
  colorOf,
  innerTubeExtent,
  internalExtent,
  MAX_ZOOM,
  WHEEL_ZOOM_FACTOR,
  ZOOM_IDENTITY,
  zoomStep,
  type MotorDims,
} from '../../tree/schematicGeometry';
import { ZoomButtons } from './ZoomButtons';
import { useWheelZoom } from './useWheelZoom';
import { keyPan } from './keyPan';
import { discDims, tubeRadii } from '../../services/design/discGeometry';
import { DISC_TYPES } from '../../services/files/componentFormats';
import { withKernelEnds } from '../../services/design/autoRadius';
import { partLabel } from '../../i18n/format';
import { radToDeg } from '../../prefs/units';
import { token } from '../common/colorTokens';

/**
 * Aft end view: the rocket seen from behind (down the +X axis). This is the
 * only place cluster layouts, pod rings and fin counts are visible as they
 * really are: the side views project everything onto one plane. It edits
 * nothing in the design: the wheel zooms, a drag at the fitted view rolls it,
 * and zoomed in a drag or the arrow keys pan it (cluster layout, rotation and
 * spacing are fields of the inner tube's property panel; edit them there and
 * watch this update).
 *
 * Convention: +y right, +z up, matching the kernel's cross-section frame
 * (cluster offsets and pod ring offsets are already {y,z} in that frame).
 */

/** Wheel step and zoom ceiling; hoisted so the hook's options keep one identity. */
const WHEEL_ZOOM = { factor: WHEEL_ZOOM_FACTOR, max: MAX_ZOOM };

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
    }
  | {
      /** An outline already in this view's frame, `[y, z]` per point: a canted fin. */
      kind: 'poly';
      key: string;
      /** The axis the part stands around. */
      y: number;
      z: number;
      points: [number, number][];
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
export function buildAftScene(
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
  const nameOf = (n: ComponentNode) => partLabel(t, n);
  // Which copy of a clustered or off-center parent the walk is inside, so a
  // part drawn once per copy keeps a unique key.
  let copy = '';
  const keyOf = (n: ComponentNode, i: number) => `${n.id ?? n.type}:${i}${copy}`;
  const motorShape = (n: ComponentNode, i: number, y: number, z: number, diameter: number): Shape => ({
    kind: 'circle',
    key: `${n.id ?? n.type}:motor:${i}${copy}`,
    y,
    z,
    r: diameter / 2,
    fill: token('sch-motor'),
    stroke: token('sch-motor-edge'),
    title: t('part.motor'),
  });

  // The entry point first, the per-child walk after it: function
  // declarations, so the mutual recursion reads top-down. The walk carries
  // each part's rocket-frame station from `x0`, because a part on a nose cone
  // or transition stands on the body radius at its own station, and returns
  // the station the chain ends at. `turn` is the angle every part of the chain
  // is turned by about its axis: the sum of the angles of the pod or booster
  // instances it sits in, which the kernel turns each child by
  // (FlightConfiguration.getActiveContextListAt, FlightConfiguration.java:470-485).
  function walkChain(nodes: ComponentNode[], cy: number, cz: number, x0: number, turn: number): number {
    let x = x0;
    for (const n of nodes) {
      if (n.type === 'stage') {
        x = walkChain(n.children ?? [], cy, cz, x, turn);
        continue;
      }
      const len = isChainType(n.type) ? partLength(n) : 0;
      const start = x;
      x += len;
      // A body tube with no radius on record is drawn at the one it flies at.
      const r = n.type === 'bodytube' ? bodyTubeRadius(n) : anyOuterRadius(n);
      if (r <= 0) continue;
      hulls.push({
        kind: 'circle',
        key: keyOf(n, 0),
        y: cy,
        z: cz,
        r,
        fill: colorOf(n, token('sch-shell-light')),
        stroke: token('sch-line'),
        title: nameOf(n),
      });
      reach(cy, cz, r);
      // Body-tube mounts (minimum/sub-minimum builds) draw their motor too, not
      // just inner tubes.
      if (n.type === 'bodytube' && n['motorMount'] === true) {
        const motor = n.id ? motors?.[n.id] : undefined;
        if (motor) inner.push(motorShape(n, 0, cy, cz, motor.diameter));
      }
      walkChildren(n, r, cy, cz, start, len, turn);
    }
    return x;
  }

  /**
   * A place across the parent (`placementOffsets`, the kernel's frame), turned
   * by the parent's `turn`, then +π/2 into this view's "up = 0°" frame, the
   * fins' reference, so a cluster or an off-center part clocks like the fins
   * and the 3D view.
   */
  const toAftFrame = (raw: { y: number; z: number }, turn: number) => {
    const off = turnedOffset(raw, turn);
    return { y: -off.z, z: off.y };
  };

  /** An internal part's outline in section: a dashed circle. */
  const dashedCircle = (child: ComponentNode, i: number, y: number, z: number, r: number, dash: string) =>
    inner.push({
      kind: 'circle',
      key: keyOf(child, i),
      y,
      z,
      r,
      fill: 'none',
      stroke: colorOf(child, token('sch-ink')),
      dash,
      title: nameOf(child),
    });

  /**
   * `parent`'s children. `pRadius` is the parent's largest radius, which sizes
   * the internal parts inside it; `surfaceUnder` is the body radius under a
   * part's station (`bodyRadiusAt`). Lugs, rail buttons, tube fins and fairings
   * can only sit on a body tube (Transition.isCompatible, treeEdit.canHost),
   * where that is the tube's radius; only a freeform fin sits on a cone or
   * transition, where it is the station's. `pStart` and `pLen` place the parent in the
   * rocket frame, and `turn` is the angle its frame is turned by (see
   * `walkChain`).
   */
  function walkChildren(
    parent: ComponentNode,
    pRadius: number,
    cy: number,
    cz: number,
    pStart: number,
    pLen: number,
    turn: number,
  ) {
    /** The body radius under a child of length `len` at its own station. */
    const surfaceUnder = (child: ComponentNode, len: number): number =>
      bodyRadiusAt(parent, axialStart(child, len, pStart, pLen) - pStart) ?? pRadius;
    for (const child of parent.children ?? []) {
      const type = child.type;
      if (isAssembly(type)) {
        const podRadius = resolveAssemblyRadius(child, assemblyParentRadius(parent));
        const podStart = axialStart(child, assemblyChainLength(child), pStart, pLen);
        const count = countOf(child, 'instanceCount', 2);
        // +π/2 so the ring's 0° reference is "straight up" (the same reference
        // the fin sets use here), matching the 3D view (see the lug note below).
        // The ring turns with the parent's frame, and each instance turns
        // everything in it by its own angle.
        ringInstanceOffsets(count, podRadius, Math.PI / 2 + num(child, 'angleOffset', 0) + turn).forEach((off, i) => {
          // Each instance draws the whole sub-chain again, so its keys name the instance.
          const outerCopy = copy;
          copy = `${outerCopy}/${child.id ?? child.type}#${i}`;
          walkChain(child.children ?? [], cy + off.y, cz + off.z, podStart, off.angle - Math.PI / 2);
          copy = outerCopy;
        });
      } else if (isPlanarFinSet(type)) {
        const count = countOf(child, 'finCount', 3);
        // The fin stands on the body radius under its own front
        // (`FinSet.getBodyRadius`), not on the parent's widest radius, and a
        // freeform fin's span reads that parent (`FreeformFinSet.getSpan`).
        const mount = finMount(child, parent, pStart);
        const fp = mount ?? pRadius;
        const R = mountRadius(fp) ?? pRadius;
        const span = finSpan(child, fp);
        const thick = num(child, 'thickness', FIN_DEFAULTS.thickness);
        const cant = finCant(child);
        // First fin straight up (desktop rear-view convention) plus the set's
        // own rotation about the body axis and the parent's turn.
        const ring = ringInstanceOffsets(count, 0, Math.PI / 2 + num(child, 'rotation', 0) + turn);
        const fill = colorOf(child, token('sch-part'));
        const title = `${nameOf(child)} ×${count}`;
        const outline = cant === 0 ? null : finOutlinePoints(child, fp);
        const closed = cant === 0 ? null : finPointsWithRoot(child, fp);
        for (const [i, { angle }] of ring.entries()) {
          if (!outline || !closed) {
            outer.push({
              kind: 'fin',
              key: keyOf(child, i),
              y: cy,
              z: cz,
              angle,
              from: R,
              to: R + span,
              thick,
              fill,
              stroke: token('sch-line'),
              title,
            });
            continue;
          }
          // A canted fin seen from behind is no longer edge on: the face the
          // cant turns toward the viewer, and the strip of trailing edge from
          // its highest point down to the root behind it (desktop's canted back
          // view). Each point is placed as the kernel places it
          // (`finBodyPoint`), in the kernel's frame, then turned into this one.
          const pose: FinPose = {
            front: 0,
            radius: R,
            chord: finRootChord(child),
            cant,
            angle: angle - Math.PI / 2,
          };
          const side = Math.sign(cant) * (thick / 2);
          const at = (x: number, y: number, z: number): [number, number] => {
            const [, by, bz] = finBodyPoint(x, y, z, pose);
            const off = toAftFrame({ y: by, z: bz }, 0);
            return [cy + off.y, cz + off.z];
          };
          let top = outline.length - 1;
          while (top > 0 && !(outline[top - 1]![1] < outline[top]![1])) top--;
          const tail = outline.slice(top);
          const polys: [number, number][][] = [
            closed.map(([x, y]) => at(x, y, side)),
            [...[...tail].reverse().map(([x, y]) => at(x, y, -side)), ...tail.map(([x, y]) => at(x, y, side))],
          ];
          polys.forEach((points, j) => {
            outer.push({
              kind: 'poly',
              key: `${keyOf(child, i)}:${j}`,
              y: cy,
              z: cz,
              points,
              fill,
              stroke: token('sch-line'),
              title,
            });
            for (const [y, z] of points) reach(y, z, 0);
          });
        }
        reach(cy, cz, R + span);
      } else if (type === 'tubefinset') {
        // The ring stands on the body radius at its own front
        // (`TubeFinSet.getBodyRadius`), which sizes an automatic tube too.
        const count = countOf(child, 'finCount', 6);
        const R = surfaceUnder(child, num(child, 'length', KERNEL_DEFAULTS.tubefinset.length));
        const rt = tubeFinRadius(child, R);
        const ring = ringInstanceOffsets(count, R + rt, Math.PI / 2 + num(child, 'rotation', 0) + turn);
        for (const [i, off] of ring.entries()) {
          outer.push({
            kind: 'circle',
            key: keyOf(child, i),
            y: cy + off.y,
            z: cz + off.z,
            r: rt,
            fill: 'none',
            stroke: token('sch-line'),
            title: `${nameOf(child)} ×${count}`,
          });
        }
        reach(cy, cz, R + 2 * rt);
      } else if (type === 'fairing') {
        // Shroud cross-section at the top (radial angle not modeled).
        const wid = num(child, 'width', KERNEL_DEFAULTS.fairing.width);
        const hgt = num(child, 'height', KERNEL_DEFAULTS.fairing.height);
        const R = surfaceUnder(child, num(child, 'length', KERNEL_DEFAULTS.fairing.length));
        outer.push({
          kind: 'fin',
          key: keyOf(child, 0),
          y: cy,
          z: cz,
          angle: Math.PI / 2,
          from: R,
          to: R + hgt,
          thick: wid,
          fill: colorOf(child, token('sch-part-light')),
          stroke: token('sch-line'),
          title: nameOf(child),
        });
        reach(cy, cz, R + hgt);
      } else if (type === 'railbutton') {
        // Seen from behind, a button is its outer diameter across and its
        // height out from the body, the kernel's own when absent, standing at
        // its radial mount angle (kernel default 180°), turned with the
        // parent's frame, on the body radius at its own station. The kernel
        // positions it as a 0-long part (RailButton never sets
        // RocketComponent.length), so the station is read with no length.
        // The +π/2 is the aft view's "up = 0°" convention.
        const { diameter, reach: out } = railButtonSize(child);
        const R = surfaceUnder(child, 0);
        outer.push({
          kind: 'fin',
          key: keyOf(child, 0),
          y: cy,
          z: cz,
          angle: Math.PI / 2 + num(child, 'angleOffset', Math.PI) + turn,
          from: R,
          to: R + out,
          thick: diameter,
          fill: colorOf(child, token('sch-part-light')),
          stroke: token('sch-line'),
          title: nameOf(child),
        });
        reach(cy, cz, R + out);
      } else if (type === 'launchlug') {
        const r = num(child, 'outerRadius', KERNEL_DEFAULTS.launchlug.outerRadius);
        // Radial mount angle (kernel default 180°). The +π/2 is the aft view's
        // "up = 0°" convention (the same offset the fin sets carry here), so a
        // lug clocks consistently with the fins and with the 3D view. It turns
        // with the parent's frame.
        const ang = Math.PI / 2 + num(child, 'angleOffset', Math.PI) + turn;
        // It stands on the tube's radius: a lug's parent is always a body tube.
        const R = surfaceUnder(child, num(child, 'length', KERNEL_DEFAULTS.launchlug.length));
        const rad = R + r;
        outer.push({
          kind: 'circle',
          key: keyOf(child, 0),
          y: cy + rad * Math.cos(ang),
          z: cz + rad * Math.sin(ang),
          r,
          fill: colorOf(child, token('sch-part-light')),
          stroke: token('sch-line'),
          title: nameOf(child),
        });
        reach(cy, cz, R + 2 * r);
      } else if (type === 'innertube') {
        const { length: tubeLen, radius: r } = innerTubeExtent(child);
        // Each cluster place, as the kernel puts it (placementOffsets).
        const offs = placementOffsets(child, r);
        const motor = child.id ? motors?.[child.id] : undefined;
        offs.forEach((raw, i) => {
          const off = toAftFrame(raw, turn);
          dashedCircle(child, i, cy + off.y, cz + off.z, r, '3 2');
          if (motor) inner.push(motorShape(child, i, cy + off.y, cz + off.z, motor.diameter));
          reach(cy + off.y, cz + off.z, r);
        });
        // Its own internal parts sit in every tube of the cluster, as the
        // kernel places a child once per parent instance.
        const tubeStart = axialStart(child, tubeLen, pStart, pLen);
        offs.forEach((raw, i) => {
          const off = toAftFrame(raw, turn);
          walkCopy(child, r, cy + off.y, cz + off.z, tubeStart, tubeLen, i, turn);
        });
      } else if (DISC_TYPES.has(type)) {
        // Sized as the side view, the 3D model and the cut sheet size it: its own
        // radii, else the bore of the tube it sits in, with a ring's bore taken
        // from the mount through it. A wall that leaves no bore is no part.
        const disc = discDims(child, tubeRadii(parent), parent.children ?? []);
        const len = disc?.length ?? partLength(child);
        const outerR = disc?.outerR ?? 0;
        // Off the axis by its own radial position.
        const off = toAftFrame(placementOffsets(child, outerR)[0]!, turn);
        if (disc) {
          const rings = disc.innerR > 0 ? [disc.outerR, disc.innerR] : [disc.outerR];
          rings.forEach((r, i) => dashedCircle(child, i, cy + off.y, cz + off.z, r, '2 3'));
        }
        // A coupler holds internal parts of its own (a bulkhead in an avionics bay).
        walkCopy(child, outerR, cy + off.y, cz + off.z, axialStart(child, len, pStart, pLen), len, 0, turn);
      } else if (child.children?.length) {
        // Parachute, streamer, shock cord and mass component draw no cross-section
        // here; a mass component's own internal parts still do.
        const { length: len, radius } = internalExtent(child, pRadius);
        const off = toAftFrame(placementOffsets(child, radius)[0]!, turn);
        walkCopy(child, radius, cy + off.y, cz + off.z, axialStart(child, len, pStart, pLen), len, 0, turn);
      }
    }
  }

  /** `walkChildren` inside copy `i` of `parent`, with the copy in every key drawn there. */
  function walkCopy(
    parent: ComponentNode,
    pRadius: number,
    cy: number,
    cz: number,
    pStart: number,
    pLen: number,
    i: number,
    turn: number,
  ) {
    const outerCopy = copy;
    copy = `${outerCopy}/${parent.id ?? parent.type}#${i}`;
    walkChildren(parent, pRadius, cy, cz, pStart, pLen, turn);
    copy = outerCopy;
  }

  // A transition end with no radius on record is drawn as the kernel resolves
  // it, as the side and 3D views draw it.
  walkChain(withKernelEnds({ name: '', components }).components, 0, 0, 0, 0);

  // Big circles first so nested ones stay visible.
  hulls.sort((a, b) => (b.kind === 'circle' ? b.r : 0) - (a.kind === 'circle' ? a.r : 0));
  return { hulls, inner, outer, extent };
}

/**
 * A client point in the viewBox's coordinates (m). The viewBox is square and
 * the element usually is not, so the drawing is letterboxed inside it
 * (`preserveAspectRatio` xMidYMid meet): the svg's screen matrix is the map
 * that knows where the drawing sits. Without one (an element not laid out),
 * the box `rect` stands for the viewBox.
 */
function clientToViewBox(
  svg: SVGSVGElement | null,
  rect: DOMRect,
  E: number,
  clientX: number,
  clientY: number,
): { vx: number; vy: number } {
  const m = typeof svg?.getScreenCTM === 'function' ? svg.getScreenCTM() : null;
  const det = m ? m.a * m.d - m.b * m.c : 0;
  if (m && det !== 0) {
    const dx = clientX - m.e;
    const dy = clientY - m.f;
    return { vx: (m.d * dx - m.c * dy) / det, vy: (m.a * dy - m.b * dx) / det };
  }
  return {
    vx: -E + ((clientX - rect.left) / rect.width) * 2 * E,
    vy: -E + ((clientY - rect.top) / rect.height) * 2 * E,
  };
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
  /** Roll angle (radians): spins the whole aft cross-section about the axis. */
  roll?: number;
  /** Horizontal drag on the fitted view spins the roll (delta radians); once
   *  zoomed in, a drag pans instead. */
  onRoll?: (deltaRadians: number) => void;
}) {
  const { t } = useTranslation();
  // Zoom/pan in viewBox (meter) coordinates, the same pattern as TreeSchematic.
  const [zoom, setZoom] = useState(ZOOM_IDENTITY);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const pan = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const rollDrag = useRef<number | null>(null); // last clientX while drag-rolling
  const zoomBy = (f: number) =>
    // About the viewBox origin: the rocket axis is always at (0,0) here.
    setZoom((z) => zoomStep(z, 0, 0, f, WHEEL_ZOOM.max));
  /**
   * The whole aft scene, rebuilt only when the design (or the language) changes.
   *
   * `onPointerMove` drives `onRoll` (a store write) on every pointer sample, so
   * building the hulls, the recursive walk and every cluster and fin instance
   * in the render body would re-walk the whole component tree per pointer
   * event while dragging to roll or wheel-zooming. `TreeSchematic` memoizes
   * `buildSchematicShapes` for the same reason.
   *
   * Roll and zoom are applied by the SVG transform below, so neither is an
   * input here: the geometry is the same drawing turned around.
   */
  const { hulls, inner, outer, extent } = useMemo(
    () => buildAftScene(tree.components, motors, t),
    [tree.components, motors, t],
  );

  const E = extent * 1.12;
  const scale = 1; // viewBox is in meters; the SVG scales itself.
  const toSvg = (v: number) => v * scale;

  // Wheel zoom about the pointer (shared hook). The mapping closes over the
  // current extent; the hook reads it through a ref, so there is no render-time
  // ref write and no listener churn when the extent changes.
  const wheelToView = useCallback(
    (e: WheelEvent, rect: DOMRect) => {
      const { vx, vy } = clientToViewBox(svgRef.current, rect, E, e.clientX, e.clientY);
      return { px: vx, py: vy };
    },
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
          fillOpacity={s.fill === token('sch-motor') ? 0.45 : undefined}
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
    if (s.kind === 'poly') {
      return (
        <polygon
          key={s.key}
          points={s.points.map(([y, z]) => `${toSvg(y)},${-toSvg(z)}`).join(' ')}
          fill={s.fill}
          stroke={s.stroke}
          strokeWidth={E / 220}
        >
          {s.title ? <title>{s.title}</title> : null}
        </polygon>
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

  const toView = (clientX: number, clientY: number) =>
    clientToViewBox(svgRef.current, svgRef.current!.getBoundingClientRect(), E, clientX, clientY);
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
        aria-label={zoom.k > 1 ? `${t('schematic.aftAria')}. ${t('schematic.panHint')}` : t('schematic.aftAria')}
        // Zoomed in, the view takes focus so the arrows can pan it, as the
        // side view does.
        tabIndex={zoom.k > 1 ? 0 : undefined}
        className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-500"
        onKeyDown={(e) => {
          const next = keyPan(zoom, e.key, e.shiftKey, 2 * E);
          if (!next) return;
          e.preventDefault();
          setZoom(next);
        }}
        onPointerDown={(e) => {
          // At the fitted view a drag rotates the roll. Zoomed in, it pans: the
          // roll slider still turns the rocket, and a wheel zoom about the
          // pointer can leave the center off screen with nothing else to bring
          // it back short of Fit.
          if (zoom.k <= 1) {
            if (!onRoll) return;
            rollDrag.current = e.clientX;
            (e.target as Element).setPointerCapture?.(e.pointerId);
            return;
          }
          const { vx, vy } = toView(e.clientX, e.clientY);
          pan.current = { px: vx, py: vy, x: zoom.x, y: zoom.y };
          (e.target as Element).setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (rollDrag.current !== null && onRoll) {
            const width = svgRef.current?.getBoundingClientRect().width || 300;
            // Negated with the drawing's rotation below, so the cross-section
            // still follows the pointer: a drag right turns it clockwise.
            onRoll((-(e.clientX - rollDrag.current) / width) * 2 * Math.PI);
            rollDrag.current = e.clientX;
            return;
          }
          // Capture the pan state here: setZoom's updater runs after this
          // handler returns, and a pointer-up in between nulls pan.current,
          // so reading it inside the updater throws on null.
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
        // A touch the OS takes over ends without a pointerup; left armed, the
        // next move would pan or roll unpressed.
        onPointerCancel={() => {
          pan.current = null;
          rollDrag.current = null;
        }}
      >
        {/* The kernel turns the rocket by the roll the same way in every view
            (desktop RocketFigure applies one rotate_x to the side and back
            views), so a part's height off the axis matches the side view's
            cos(angle + roll). With this view's angles running counterclockwise
            on screen, that is a counterclockwise turn: SVG rotate() is clockwise. */}
        <g transform={`translate(${zoom.x} ${zoom.y}) scale(${zoom.k}) rotate(${-radToDeg(roll)})`}>
          {hulls.map(drawShape)}
          {inner.map(drawShape)}
          {outer.map(drawShape)}
          {/* Center crosshair */}
          <line x1={-E * 0.05} y1={0} x2={E * 0.05} y2={0} stroke={token('sch-ink')} strokeWidth={E / 300} />
          <line x1={0} y1={-E * 0.05} x2={0} y2={E * 0.05} stroke={token('sch-ink')} strokeWidth={E / 300} />
        </g>
      </svg>
      <div className="schematic-controls">
        <ZoomButtons zoom={zoom} setZoom={setZoom} zoomBy={zoomBy} />
      </div>
    </div>
  );
}
