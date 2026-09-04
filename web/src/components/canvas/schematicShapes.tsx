import type { ComponentNode } from '../../engine/openRocketEngine';
import { num } from '../../tree/nodeProps';
import { clusterOffsets } from '../../tree/cluster.js';
import { tubeFinRadius } from '../../tree/tubefins.js';
import { DISPLAY_NAME } from '../../tree/schema.js';
import {
  assemblyChainLength, isAssembly,
  resolveAssemblyRadius, ringInstanceOffsets,
} from '../../tree/assembly.js';
import { axialStart, finTabFront, profilePath, type Ctx } from './schematicGeometry';

const fillOf = (n: ComponentNode, dflt: string): string =>
  typeof n['color'] === 'string' ? (n['color'] as string) : dflt;

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
  hoverBox: { x0: number; y0: number; x1: number; y1: number } | null;
  hoverTag: { x: number; y: number; tw: number } | null;
  hoverName: string;
} {
  const {
    chain, ctx, scale, w, h, roll, motors, vertical,
    selectedId, onSelect, setHoverId, hoverId, onPatchNode, beginDrag, dragMoved, textUp,
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
  let key = 0;

  // Hovered component's drawn extent (layout px), unioned across instances
  // (cluster copies, pod rings) as the shapes render.
  const hoverBoxes: { x0: number; y0: number; x1: number; y1: number }[] = [];
  let hoverName = '';
  const noteHover = (n: ComponentNode, x0: number, y0: number, x1: number, y1: number) => {
    if (!hoverId || n.id !== hoverId) return;
    hoverName = n.name ?? DISPLAY_NAME[n.type];
    hoverBoxes.push({
      x0: Math.min(x0, x1), y0: Math.min(y0, y1),
      x1: Math.max(x0, x1), y1: Math.max(y0, y1),
    });
  };

  // Loaded motor case (S5): launch-orange tint at the real case size, with
  // the designation printed in the case when it's long enough to carry it.
  const motorShapes = (
    motor: { length: number; diameter: number; label?: string },
    mStart: number, cY: number,
  ): React.ReactNode[] => {
    const mR = motor.diameter / 2;
    const out: React.ReactNode[] = [
      <rect key={key++} x={ctx.x0 + mStart * ctx.scale} y={cY - mR * ctx.scale}
        width={Math.max(2, motor.length * ctx.scale)} height={Math.max(2, 2 * mR * ctx.scale)}
        rx="1" fill="var(--launch)" fillOpacity="0.85"
        stroke="#e0764a" strokeWidth="0.8"
        style={{ pointerEvents: 'none' }} />,
    ];
    if (motor.label && motor.length * ctx.scale > 36) {
      const lx = ctx.x0 + (mStart + motor.length / 2) * ctx.scale;
      out.push(
        <text key={key++} x={lx} y={cY} textAnchor="middle" dominantBaseline="central"
          fontSize="10" fontWeight="bold" fill="#ffffff" {...textUp(lx, cY)}
          style={{ pointerEvents: 'none' }}>
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
      if (isAssembly(t)) {
        const podChain = child.children ?? [];
        const podLen = assemblyChainLength(child);
        const podRadius = resolveAssemblyRadius(child, pRadius);
        const podStart = axialStart(child, podLen, pStart, pLen);
        const count = Math.max(1, Math.round(num(child, 'instanceCount', 2)));
        for (const off of ringInstanceOffsets(count, podRadius, num(child, 'angleOffset', 0))) {
          renderChain(podChain, podStart, baseY + off.y * ctx.scale);
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
      // Through-the-wall fin tab: dashed rect from the body surface inward.
      const renderTab = (finStart: number, finLen: number) => {
        const tabH = Math.min(num(child, 'tabHeight', 0), pRadius);
        const tabLen = num(child, 'tabLength', 0);
        if (tabH <= 0 || tabLen <= 0) return;
        const front = finStart + finTabFront(child, finLen);
        for (const dir of [1, -1] as const) {
          const yTop = dir === 1
            ? baseY + (pRadius - tabH) * ctx.scale
            : baseY - pRadius * ctx.scale;
          shapes.push(
            <rect key={key++} x={ctx.x0 + front * ctx.scale} y={yTop}
              width={Math.max(2, tabLen * ctx.scale)} height={Math.max(1.5, tabH * ctx.scale)}
              fill={fillOf(child, '#b9b7b0')} fillOpacity="0.35"
              stroke="#7a786f" strokeWidth="1" strokeDasharray="3 2"
              style={{ pointerEvents: 'none' }} />,
          );
        }
      };
      if (t === 'freeformfinset') {
        const raw = (child['points'] as [number, number][] | undefined) ?? [];
        if (raw.length >= 3) {
          const chord = Math.max(...raw.map((p) => p[0]));
          const start = axialStart(child, chord, pStart, pLen);
          const ymax = Math.max(0, ...raw.map((p) => p[1]));
          noteHover(child, ctx.x0 + start * ctx.scale, baseY - (pRadius + ymax) * ctx.scale,
            ctx.x0 + (start + chord) * ctx.scale, baseY + (pRadius + ymax) * ctx.scale);
          for (const dir of [1, -1] as const) {
            const ptsStr = raw
              .map(([px, py]) => `${ctx.x0 + (start + px) * ctx.scale},${baseY + dir * (pRadius + py) * ctx.scale}`)
              .join(' ');
            shapes.push(
              <polygon key={key++} points={ptsStr}
                fill={fillOf(child, '#b9b7b0')} stroke={selStroke(child, '#7a786f')}
                strokeWidth={selWidth(child)} {...grab} />,
            );
          }
          renderTab(start, chord);
        }
      } else if (t === 'trapezoidfinset' || t === 'ellipticalfinset') {
        const root = num(child, 'rootChord', 0.05);
        const tip = t === 'trapezoidfinset' ? num(child, 'tipChord', root * 0.6) : 0;
        const sweep = t === 'trapezoidfinset' ? num(child, 'sweep', 0.02) : root / 2;
        const height = num(child, 'height', 0.03);
        const start = axialStart(child, root, pStart, pLen);
        noteHover(child, ctx.x0 + start * ctx.scale, baseY - (pRadius + height) * ctx.scale,
          ctx.x0 + (start + Math.max(root, sweep + tip)) * ctx.scale,
          baseY + (pRadius + height) * ctx.scale);
        // Spin about the axis: each of the N fins projects into the side view
        // by cos(roll + i·2π/N). |cos|=1 → broadside (full height), 0 → edge-on
        // (invisible). Draw edge-on-ish fins last so broadside ones sit on top.
        const finCount = Math.max(1, Math.round(num(child, 'finCount', 3)));
        const projected = Array.from({ length: finCount }, (_, fi) => Math.cos(roll + (fi * 2 * Math.PI) / finCount))
          .filter((p) => Math.abs(p) >= 0.03)
          .sort((a, b) => Math.abs(a) - Math.abs(b));
        for (const proj of projected) {
          const dir = proj >= 0 ? 1 : -1;
          const hp = height * Math.abs(proj);
          const y0 = baseY + dir * pRadius * ctx.scale;
          const yh = baseY + dir * (pRadius + hp) * ctx.scale;
          const X = ctx.x0 + start * ctx.scale;
          shapes.push(
            t === 'trapezoidfinset' ? (
              <polygon key={key++}
                points={`${X},${y0} ${X + sweep * ctx.scale},${yh} ${X + (sweep + tip) * ctx.scale},${yh} ${X + root * ctx.scale},${y0}`}
                fill={fillOf(child, '#b9b7b0')} stroke={selStroke(child, '#7a786f')}
                strokeWidth={selWidth(child)} {...grab} />
            ) : (
              // Elliptical fin = the top half of an ellipse: major axis = root
              // chord (horizontal), semi-minor axis = span. An SVG arc draws it
              // exactly and reaches the FULL span — a quadratic Bézier only bent
              // ~halfway to its control point, drawing the fin at ~half height.
              <path key={key++}
                d={`M ${X} ${y0} A ${(root / 2) * ctx.scale} ${hp * ctx.scale} 0 0 ${dir > 0 ? 1 : 0} ${X + root * ctx.scale} ${y0} Z`}
                fill={fillOf(child, '#b9b7b0')} stroke={selStroke(child, '#7a786f')}
                strokeWidth={selWidth(child)} {...grab} />
            ),
          );
        }
        renderTab(start, root);
      } else if (t === 'tubefinset') {
        // Side view: the top and bottom tubes of the ring, sitting on the
        // body surface (side tubes project onto the body — omitted). Each
        // is drawn as its silhouette rectangle with a center line hinting
        // at the tube bore.
        const len = num(child, 'length', 0.1);
        const rt = tubeFinRadius(child, pRadius);
        const start = axialStart(child, len, pStart, pLen);
        const X = ctx.x0 + start * ctx.scale;
        noteHover(child, X, baseY - (pRadius + 2 * rt) * ctx.scale,
          X + len * ctx.scale, baseY + (pRadius + 2 * rt) * ctx.scale);
        for (const dir of [1, -1] as const) {
          const yNear = baseY + dir * pRadius * ctx.scale;
          const yFar = baseY + dir * (pRadius + 2 * rt) * ctx.scale;
          shapes.push(
            <rect key={key++} x={X} y={Math.min(yNear, yFar)}
              width={Math.max(2, len * ctx.scale)} height={Math.abs(yFar - yNear)}
              rx="2" fill={fillOf(child, '#c8c5be')} fillOpacity="0.6"
              stroke={selStroke(child, '#7a786f')} strokeWidth={selWidth(child)} {...grab} />,
            <line key={key++} x1={X} y1={(yNear + yFar) / 2} x2={X + len * ctx.scale} y2={(yNear + yFar) / 2}
              stroke="#7a786f" strokeWidth="0.8" strokeDasharray="4 3"
              style={{ pointerEvents: 'none' }} />,
          );
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
            <polygon key={key++}
              points={`${X},${y0} ${X + 0.3 * len * ctx.scale},${yh} ${X + 0.7 * len * ctx.scale},${yh} ${Xe},${y0}`}
              fill={fillOf(child, '#c8c5be')} stroke={selStroke(child, '#7a786f')}
              strokeWidth={selWidth(child)} {...grab} />
          ) : fshape === 'halfround' ? (
            <path key={key++}
              d={`M ${X} ${y0} L ${X} ${yh + 0.35 * (y0 - yh)} Q ${X} ${yh} ${X + Math.min(8, len * ctx.scale * 0.25)} ${yh} L ${Xe - Math.min(8, len * ctx.scale * 0.25)} ${yh} Q ${Xe} ${yh} ${Xe} ${yh + 0.35 * (y0 - yh)} L ${Xe} ${y0} Z`}
              fill={fillOf(child, '#c8c5be')} stroke={selStroke(child, '#7a786f')}
              strokeWidth={selWidth(child)} {...grab} />
          ) : (
            <rect key={key++} x={X} y={yh}
              width={Math.max(2, len * ctx.scale)} height={Math.max(2, hgt * ctx.scale)}
              fill={fillOf(child, '#c8c5be')} stroke={selStroke(child, '#7a786f')}
              strokeWidth={selWidth(child)} {...grab} />
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
          <rect key={key++} x={ctx.x0 + start * ctx.scale} y={yTop}
            width={Math.max(2, len * ctx.scale)} height={h}
            fill={fillOf(child, '#c8c5be')} stroke={selStroke(child, '#7a786f')}
            strokeWidth={selWidth(child)} {...grab} />,
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
        const offsets = child.type === 'innertube'
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
          noteHover(child, ctx.x0 + start * ctx.scale, baseY + (off.y - r) * ctx.scale,
            ctx.x0 + (start + len) * ctx.scale, baseY + (off.y + r) * ctx.scale);
          overlay.push(
            <rect key={key++} x={ctx.x0 + start * ctx.scale}
              y={baseY + (off.y - r) * ctx.scale}
              width={Math.max(2, len * ctx.scale)} height={2 * r * ctx.scale}
              fill={child.type === 'bulkhead' ? 'url(#bulkhead-hatch)' : 'rgba(127,127,127,0.001)'}
              stroke={inkColor} strokeWidth={selWidth(child)}
              strokeDasharray="3 2" {...grab}>
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
            const glyphProps = { stroke: fillOf(child, style?.stroke ?? '#9a978f'), fill: 'none', strokeWidth: 1.2, style: { pointerEvents: 'none' as const } };
            if (child.type === 'parachute') {
              overlay.push(
                <g key={key++} {...glyphProps}>
                  <path d={`M ${gcx - g} ${gcy} A ${g} ${g} 0 0 1 ${gcx + g} ${gcy}`} />
                  <path d={`M ${gcx - g} ${gcy} L ${gcx} ${gcy + g} L ${gcx + g} ${gcy} M ${gcx - g * 0.45} ${gcy - g * 0.65} L ${gcx} ${gcy + g} M ${gcx + g * 0.45} ${gcy - g * 0.65} L ${gcx} ${gcy + g}`} />
                </g>,
              );
            } else if (child.type === 'masscomponent') {
              overlay.push(
                <g key={key++} {...glyphProps}>
                  <rect x={gcx - g * 0.7} y={gcy - g * 0.35} width={g * 1.4} height={g * 1.05}
                    fill={fillOf(child, style?.stroke ?? '#9a978f')} fillOpacity="0.35" />
                  <path d={`M ${gcx - g * 0.35} ${gcy - g * 0.35} A ${g * 0.4} ${g * 0.5} 0 0 1 ${gcx + g * 0.35} ${gcy - g * 0.35}`} />
                </g>,
              );
            } else if (child.type === 'centeringring') {
              // Ring cross-section: material near the walls, bore in the middle.
              overlay.push(
                <g key={key++} {...glyphProps}>
                  <line x1={gcx} y1={gcy - bh / 2 + 1.5} x2={gcx} y2={gcy - bh * 0.16} strokeWidth={Math.max(2, bw * 0.5)} />
                  <line x1={gcx} y1={gcy + bh * 0.16} x2={gcx} y2={gcy + bh / 2 - 1.5} strokeWidth={Math.max(2, bw * 0.5)} />
                </g>,
              );
            } else if (child.type === 'shockcord') {
              const seg = gs / 4;
              overlay.push(
                <path key={key++} {...glyphProps}
                  d={`M ${gcx - g} ${gcy} ${[1, 2, 3, 4].map((i) => `L ${gcx - g + i * seg * 2 - seg} ${gcy + (i % 2 ? -1 : 1) * g * 0.45} L ${gcx - g + i * seg * 2} ${gcy}`).join(' ')}`} />,
              );
            }
          }
          // Type tag, when the box has room for it — glyph types skip the
          // text once their picture is drawn. Counter-rotated tags read
          // horizontally in vertical mode, so the room roles swap.
          const hasGlyph = gs >= 8
            && ['parachute', 'masscomponent', 'centeringring', 'shockcord'].includes(child.type);
          const tagRoom = vertical
            ? 2 * r * ctx.scale > 26 && len * ctx.scale > 11
            : len * ctx.scale > 26 && 2 * r * ctx.scale > 11;
          if (style && !hasGlyph && tagRoom) {
            const tx = ctx.x0 + (start + len / 2) * ctx.scale;
            const ty = baseY + off.y * ctx.scale;
            overlay.push(
              <text key={key++} x={tx} y={ty}
                textAnchor="middle" dominantBaseline="central"
                fontSize="8.5" fill={fillOf(child, style.stroke)} {...textUp(tx, ty)}
                style={{ pointerEvents: 'none', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {style.tag}
              </text>,
            );
          }
          if (motor) {
            overlay.push(...motorShapes(
              motor, start + len - motor.length + num(child, 'motorOverhang', 0),
              baseY + off.y * ctx.scale));
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
      <rect key={key++} x={ctx.x0 + startX * scale} y={baseY - rSi * scale}
        width={Math.max(1.5, lenSi * scale)} height={2 * rSi * scale}
        fill="rgba(127,127,127,0.001)" stroke={color} strokeWidth="1"
        strokeDasharray="3 2" style={{ pointerEvents: 'none' }} />,
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
        shapes.push(<path key={key++} d={profilePath(ctx, n, cx, len, 0, r, baseY)} fill={fillOf(n, '#d5d2cb')}
          stroke={selStroke(n, '#7a786f')} strokeWidth={selWidth(n)} {...clickable(n)} />);
        shoulderRect(cx + len, num(n, 'shoulderLength', 0), num(n, 'shoulderRadius', 0), '#9a978f', baseY);
        renderChildren(n, cx, len, r, baseY);
        cx += len;
      } else if (n.type === 'bodytube') {
        const r = num(n, 'outerRadius', 0.012);
        noteHover(n, ctx.x0 + cx * scale, baseY - r * scale, ctx.x0 + (cx + len) * scale, baseY + r * scale);
        shapes.push(
          <rect key={key++} x={ctx.x0 + cx * scale} y={baseY - r * scale}
            width={len * scale} height={2 * r * scale}
            fill={fillOf(n, '#e7e5e0')} stroke={selStroke(n, '#7a786f')}
            strokeWidth={selWidth(n)} {...clickable(n)} />,
        );
        // Min-diameter: a motor loaded directly in this body tube draws at its
        // real case size, seated flush against the tube's aft end.
        const tubeMotor = n.id ? motors?.[n.id] : undefined;
        if (tubeMotor) {
          shapes.push(...motorShapes(
            tubeMotor, cx + len - tubeMotor.length + num(n, 'motorOverhang', 0), baseY));
        }
        renderChildren(n, cx, len, r, baseY);
        cx += len;
      } else if (n.type === 'transition') {
        const rf = num(n, 'foreRadius', 0.012);
        const ra = num(n, 'aftRadius', 0.009);
        noteHover(n, ctx.x0 + cx * scale, baseY - Math.max(rf, ra) * scale,
          ctx.x0 + (cx + len) * scale, baseY + Math.max(rf, ra) * scale);
        shapes.push(
          <path key={key++} d={profilePath(ctx, n, cx, len, rf, ra, baseY)}
            fill={fillOf(n, '#d5d2cb')} stroke={selStroke(n, '#7a786f')}
            strokeWidth={selWidth(n)} {...clickable(n)} />,
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
      x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0),
      x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1),
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

  return { shapes, overlay, hoverBox, hoverTag, hoverName };
}
