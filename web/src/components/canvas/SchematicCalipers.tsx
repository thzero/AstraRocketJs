import { useTranslation } from 'react-i18next';
import { useUnits } from '../../prefs/useUnits';
import type { Ctx } from './schematicGeometry';

/**
 * The TreeSchematic measure tool: the two caliper overlays (length and
 * diameter), each a pair of draggable, keyboard-nudgeable slider handles with
 * the measured span tagged between them. The schematic owns the caliper
 * positions and the drag/key handlers; this file owns how a caliper looks.
 */

/**
 * Length calipers: two draggable vertical lines spanning the drawing height,
 * with the measured distance in a tag between them. A component of its own (it
 * was an IIFE inside the JSX) so the handles can be read, and reasoned about,
 * apart from the view they sit in.
 */
export function HorizontalCaliper({
  cal,
  ctx,
  scale,
  h,
  rBot,
  totalLen,
  onDragStart,
  onKey,
}: {
  cal: { a: number; b: number };
  ctx: Ctx;
  scale: number;
  h: number;
  rBot: number;
  totalLen: number;
  onDragStart: (end: 'a' | 'b') => (e: React.PointerEvent) => void;
  onKey: (end: 'a' | 'b') => (e: React.KeyboardEvent) => void;
}) {
  const { t } = useTranslation();
  const u = useUnits();
  const ax = ctx.x0 + cal.a * scale,
    bx = ctx.x0 + cal.b * scale;
  const top = 4,
    bot = h - rBot - 2,
    dimY = 14,
    mid = (ax + bx) / 2;
  return (
    <g>
      {(['a', 'b'] as const).map((k) => {
        const x = ctx.x0 + cal[k] * scale;
        return (
          <g key={k}>
            <line
              x1={x}
              y1={top}
              x2={x}
              y2={bot}
              stroke="var(--accent)"
              strokeWidth="1"
              strokeDasharray="4 3"
              vectorEffect="non-scaling-stroke"
            />
            <rect
              x={x - 5}
              y={top}
              width={10}
              height={bot - top}
              fill="transparent"
              style={{ cursor: 'ew-resize', pointerEvents: 'all' }}
              onPointerDown={onDragStart(k)}
              tabIndex={0}
              role="slider"
              aria-label={t('schematic.caliperH', { end: k === 'a' ? 1 : 2 })}
              aria-orientation="horizontal"
              aria-valuemin={0}
              aria-valuemax={totalLen}
              aria-valuenow={cal[k]}
              aria-valuetext={`${u.fmt('length', cal[k])} ${u.sym('length')}`}
              onKeyDown={onKey(k)}
            />
            <circle cx={x} cy={top + 2} r={3.5} fill="var(--accent)" pointerEvents="none" />
          </g>
        );
      })}
      <g pointerEvents="none">
        <line
          x1={ax}
          y1={dimY}
          x2={bx}
          y2={dimY}
          stroke="var(--accent)"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
        <rect
          x={mid - 28}
          y={dimY - 9}
          width={56}
          height={14}
          rx="3"
          fill="rgba(13,14,18,0.92)"
          stroke="var(--accent)"
          strokeWidth="0.8"
        />
        <text x={mid} y={dimY - 1} textAnchor="middle" fontSize="9" fontWeight="bold" fill="var(--accent)">
          {u.fmt('length', Math.abs(cal.b - cal.a))} {u.sym('length')}
        </text>
      </g>
    </g>
  );
}

/** Diameter calipers: two draggable horizontal lines across the airframe, the
 *  span between them tagged at the left. Same shape as HorizontalCaliper. */
export function VerticalCaliper({
  cal,
  ctx,
  scale,
  totalLen,
  vHalf,
  onDragStart,
  onKey,
}: {
  cal: { a: number; b: number };
  ctx: Ctx;
  scale: number;
  totalLen: number;
  vHalf: number;
  onDragStart: (end: 'a' | 'b') => (e: React.PointerEvent) => void;
  onKey: (end: 'a' | 'b') => (e: React.KeyboardEvent) => void;
}) {
  const { t } = useTranslation();
  const u = useUnits();
  const ay = ctx.cy - cal.a * scale,
    by = ctx.cy - cal.b * scale;
  const left = ctx.x0,
    right = ctx.x0 + totalLen * scale;
  const dimX = ctx.x0 + 20,
    mid = (ay + by) / 2;
  return (
    <g>
      {(['a', 'b'] as const).map((k) => {
        const y = ctx.cy - cal[k] * scale;
        return (
          <g key={k}>
            <line
              x1={left}
              y1={y}
              x2={right}
              y2={y}
              stroke="var(--accent)"
              strokeWidth="1"
              strokeDasharray="4 3"
              vectorEffect="non-scaling-stroke"
            />
            <rect
              x={left - 4}
              y={y - 8}
              width={34}
              height={16}
              fill="transparent"
              style={{ cursor: 'ns-resize', pointerEvents: 'all' }}
              onPointerDown={onDragStart(k)}
              tabIndex={0}
              role="slider"
              aria-label={t('schematic.caliperV', { end: k === 'a' ? 1 : 2 })}
              aria-orientation="vertical"
              aria-valuemin={-vHalf}
              aria-valuemax={vHalf}
              aria-valuenow={cal[k]}
              aria-valuetext={`${u.fmt('length', cal[k])} ${u.sym('length')}`}
              onKeyDown={onKey(k)}
            />
            <circle cx={left + 4} cy={y} r={3.5} fill="var(--accent)" pointerEvents="none" />
          </g>
        );
      })}
      <g pointerEvents="none">
        <line
          x1={dimX}
          y1={ay}
          x2={dimX}
          y2={by}
          stroke="var(--accent)"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
        <rect
          x={dimX - 24}
          y={mid - 7}
          width={48}
          height={14}
          rx="3"
          fill="rgba(13,14,18,0.92)"
          stroke="var(--accent)"
          strokeWidth="0.8"
        />
        <text x={dimX} y={mid + 3} textAnchor="middle" fontSize="9" fontWeight="bold" fill="var(--accent)">
          {u.fmt('length', Math.abs(cal.a - cal.b))}
        </text>
      </g>
    </g>
  );
}
