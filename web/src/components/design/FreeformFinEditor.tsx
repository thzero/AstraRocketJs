import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { UnitChip } from '../common/UnitChip';
import { NumberInput } from '../common/NumberInput';
import { useUnits } from '../../prefs/useUnits';
import { unitScope } from '../../prefs/units';

type Pt = [number, number];

// Fallback outline (a small swept trapezoid) when a node somehow has < 3 points,
// so the editor always has something to draw; the first edit materialises it.
const FALLBACK: Pt[] = [
  [0, 0],
  [0.02, 0.05],
  [0.05, 0.05],
  [0.06, 0],
];

/**
 * Graphical editor for a freeform fin's outline. Points are [x, y] in metres:
 * x runs along the body (root direction), y is height above the body surface;
 * the outline is closed with the root along y = 0. Drag the amber vertices to
 * reshape, tap a blue edge-midpoint to insert a vertex, select one to delete it
 * or type exact coordinates. Emits the full point list on every change.
 */
export function FreeformFinEditor({
  points,
  onChange,
  onCommit,
}: {
  points: Pt[];
  onChange: (pts: Pt[]) => void;
  onCommit?: () => void;
}) {
  const { t } = useTranslation();
  const u = useUnits();
  const ptX = u.at(unitScope('freeform', 'x'), 'length');
  const ptY = u.at(unitScope('freeform', 'y'), 'length');
  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef<number | null>(null);
  const [sel, setSel] = useState<number | null>(null);

  const pts: Pt[] = points.length >= 3 ? points : FALLBACK;

  const W = 300,
    H = 180,
    PAD = 22;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const xMin = Math.min(0, ...xs);
  const xMax = Math.max(xMin + 0.01, ...xs);
  const yMax = Math.max(0.01, ...ys);
  const scale = Math.min((W - 2 * PAD) / (xMax - xMin), (H - 2 * PAD) / yMax);
  const sx = (x: number) => PAD + (x - xMin) * scale;
  const sy = (y: number) => H - PAD - y * scale;

  // Pointer (screen) → viewBox coords, robust to CSS scaling.
  const toVB = (e: React.PointerEvent): DOMPoint | null => {
    const ctm = svgRef.current?.getScreenCTM();
    if (!ctm) return null;
    return new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
  };

  // Fin stays above the body (y ≥ 0) and forward of the origin (x ≥ 0).
  const setPoint = (i: number, x: number, y: number) =>
    onChange(pts.map((p, j) => (j === i ? ([Math.max(0, x), Math.max(0, y)] as Pt) : p)));

  const onMove = (e: React.PointerEvent) => {
    if (dragging.current == null) return;
    const p = toVB(e);
    if (p) setPoint(dragging.current, xMin + (p.x - PAD) / scale, (H - PAD - p.y) / scale);
  };

  const startDrag = (i: number) => (e: React.PointerEvent) => {
    e.stopPropagation();
    dragging.current = i;
    setSel(i);
    svgRef.current?.setPointerCapture(e.pointerId);
  };
  const endDrag = (e: React.PointerEvent) => {
    if (dragging.current != null) onCommit?.(); // a drag is one undo entry, closed on release
    dragging.current = null;
    svgRef.current?.releasePointerCapture?.(e.pointerId);
  };

  const insertAfter = (i: number) => {
    const a = pts[i]!,
      b = pts[(i + 1) % pts.length]!;
    onChange([...pts.slice(0, i + 1), [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as Pt, ...pts.slice(i + 1)]);
    setSel(i + 1);
    onCommit?.();
  };
  const removeSel = () => {
    if (sel == null || pts.length <= 3) return;
    onChange(pts.filter((_, j) => j !== sel));
    setSel(null);
    onCommit?.();
  };

  const poly = pts.map((p) => `${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join(' ');
  const selPt = sel != null ? pts[sel] : undefined;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-400">{t('freeform.outline')}</span>
        <button
          onClick={removeSel}
          disabled={sel == null || pts.length <= 3}
          className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700 disabled:opacity-40"
        >
          {t('freeform.removePoint')}
        </button>
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        className="block touch-none rounded-lg bg-slate-950 ring-1 ring-white/10"
        onPointerMove={onMove}
        onPointerUp={endDrag}
      >
        {/* body surface (root line) */}
        <line x1={PAD / 2} y1={sy(0)} x2={W - PAD / 2} y2={sy(0)} className="stroke-white/15" strokeDasharray="4 3" />
        <polygon points={poly} fill="#fbbf24" fillOpacity="0.18" stroke="#fbbf24" strokeWidth="1.5" />
        {/* edge midpoints — click to insert a vertex */}
        {pts.map((p, i) => {
          const b = pts[(i + 1) % pts.length]!;
          return (
            <circle
              key={`add-${i}`}
              cx={(sx(p[0]) + sx(b[0])) / 2}
              cy={(sy(p[1]) + sy(b[1])) / 2}
              r="4"
              className="cursor-pointer fill-sky-500/60 hover:fill-sky-400"
              onPointerDown={(e) => {
                e.stopPropagation();
                insertAfter(i);
              }}
            />
          );
        })}
        {/* vertices — drag to move */}
        {pts.map((p, i) => (
          <circle
            key={`v-${i}`}
            cx={sx(p[0])}
            cy={sy(p[1])}
            r="5.5"
            strokeWidth="1.5"
            className={`cursor-grab stroke-slate-900 ${sel === i ? 'fill-amber-300' : 'fill-amber-500'}`}
            onPointerDown={startDrag(i)}
          />
        ))}
      </svg>

      {selPt && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
          <span className="text-slate-500">{t('freeform.point', { n: sel! + 1 })}</span>
          <label className="flex items-center gap-1">
            X
            {/* NumberInput, not a raw <input>: the old
                `value={+v.toFixed(3)}` + `parseFloat(...) || 0` round-trip is
                exactly what it was written to replace. Select-all and type a
                replacement and the field is briefly empty -- which parsed to 0
                and snapped the vertex to the origin, deforming the outline as a
                real tree edit. A leading `-` did the same. */}
            <NumberInput
              value={ptX.toUi(selPt[0])}
              onChange={(v) => setPoint(sel!, ptX.fromUi(v ?? 0), selPt[1])}
              onCommit={onCommit}
              step={ptX.step(0.001)}
              ariaLabel="X"
              className="w-16 rounded bg-slate-800 px-1.5 py-0.5 text-right tabular-nums text-slate-100 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500"
            />
            <UnitChip label="X" quantity="length" scope={unitScope('freeform', 'x')} />
          </label>
          <label className="flex items-center gap-1">
            Y
            <NumberInput
              value={ptY.toUi(selPt[1])}
              onChange={(v) => setPoint(sel!, selPt[0], ptY.fromUi(v ?? 0))}
              onCommit={onCommit}
              step={ptY.step(0.001)}
              ariaLabel="Y"
              className="w-16 rounded bg-slate-800 px-1.5 py-0.5 text-right tabular-nums text-slate-100 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500"
            />
            <UnitChip label="Y" quantity="length" scope={unitScope('freeform', 'y')} />
          </label>
        </div>
      )}
      <p className="text-[11px] leading-snug text-slate-500">{t('freeform.hint')}</p>
    </div>
  );
}
