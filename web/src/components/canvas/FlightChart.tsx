import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FlightResult } from '../../engine/openRocketEngine';
import { fmtNum } from '../../i18n/format';

/**
 * Flight profile chart (adapted from Vector Celeste's FlightChart): time on x,
 * a selectable series (altitude / velocity / acceleration) on y, drawn as a
 * filled area + line with value gridlines and dashed markers for flight events
 * (burnout / apogee / deploy / landing). Fills its container — a ResizeObserver
 * feeds the real pixel size into the viewBox so nothing stretches.
 */
type Variable = 'altitude' | 'velocity' | 'acceleration';
const UNIT: Record<Variable, string> = { altitude: 'm', velocity: 'm/s', acceleration: 'm/s²' };

// Engine FlightEvent.Type names worth marking → i18n label keys, most-significant first.
const EVENT_LABEL: Record<string, string> = {
  APOGEE: 'flight.apogee',
  BURNOUT: 'flight.burnout',
  RECOVERY_DEVICE_DEPLOYMENT: 'flight.deploy',
  EJECTION_CHARGE: 'flight.ejection',
  GROUND_HIT: 'flight.landing',
};
const PRIORITY = ['APOGEE', 'BURNOUT', 'RECOVERY_DEVICE_DEPLOYMENT', 'EJECTION_CHARGE', 'GROUND_HIT'];

export function FlightChart({ result }: { result: FlightResult }) {
  const { t } = useTranslation();
  const [variable, setVariable] = useState<Variable>('altitude');
  const hostRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 640, h: 340 });

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize({ w: Math.max(280, r.width), h: Math.max(160, r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { pts, maxT, maxV, events } = useMemo(() => {
    const time = result.series.time ?? [];
    const raw = (result.series[variable] ?? []) as number[];
    const vals = variable === 'altitude' ? raw : raw.map(Math.abs);
    const p = time.map((ti, i) => [ti, vals[i] ?? 0] as const).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
    const mt = Math.max(result.summary.flightTime || 1, ...p.map((q) => q[0]), 1);
    const mv = Math.max(1, ...p.map((q) => q[1])) * 1.1;
    const ev = (result.events ?? []).filter((e) => EVENT_LABEL[e.type] && e.time <= mt);
    return { pts: p, maxT: mt, maxV: mv, events: ev };
  }, [result, variable]);

  const W = size.w, H = size.h;
  const pad = { l: 54, r: 18, t: 26, b: 30 };
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const X = (v: number) => pad.l + (v / maxT) * iw;
  const Y = (v: number) => pad.t + (1 - v / maxV) * ih;

  // Group near-coincident events (small rockets fire burnout→apogee→deploy within
  // ~a second), label each cluster with its most significant event, then stagger.
  const laidEvents = useMemo(() => {
    const groups: { x: number; type: string }[] = [];
    for (const e of [...events].sort((a, b) => a.time - b.time)) {
      const x = X(e.time);
      const last = groups[groups.length - 1];
      if (last && x - last.x < 18) {
        if (PRIORITY.indexOf(e.type) < PRIORITY.indexOf(last.type)) last.type = e.type;
      } else groups.push({ x, type: e.type });
    }
    let lastGx = -Infinity, grow = 0;
    return groups.map((g) => {
      grow = g.x - lastGx < 52 ? (grow === 0 ? 1 : 0) : 0;
      lastGx = g.x;
      return { type: g.type, x: g.x, ly: pad.t - 4 - grow * 10 };
    });
  }, [events, maxT, iw]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasData = pts.length >= 2;
  const line = hasData ? pts.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' ') : '';
  const area = hasData
    ? `M${X(pts[0][0]).toFixed(1)},${(H - pad.b).toFixed(1)} ${pts.map((p) => `L${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' ')} L${X(pts[pts.length - 1][0]).toFixed(1)},${(H - pad.b).toFixed(1)} Z`
    : '';

  return (
    <div className="flex h-full flex-col rounded-xl bg-slate-900 ring-1 ring-white/10">
      <div className="flex items-center justify-between gap-2 p-3 pb-1">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t('flight.title')}</h2>
        <select
          value={variable} onChange={(e) => setVariable(e.target.value as Variable)}
          className="rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-200 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500"
        >
          <option value="altitude">{t('flight.altitude')}</option>
          <option value="velocity">{t('flight.velocity')}</option>
          <option value="acceleration">{t('flight.acceleration')}</option>
        </select>
      </div>
      <div ref={hostRef} className="min-h-0 flex-1">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" className="block" preserveAspectRatio="none">
          <defs>
            <linearGradient id="fc-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0, 1, 2, 3, 4].map((i) => {
            const gy = pad.t + (ih * i) / 4;
            const val = maxV * (1 - i / 4);
            return (
              <g key={i}>
                <line x1={pad.l} y1={gy} x2={W - pad.r} y2={gy} className="stroke-white/10" />
                <text x={pad.l - 6} y={gy + 3} textAnchor="end" className="fill-slate-500 text-[10px] tabular-nums">
                  {fmtNum(val, 0)}{i === 0 ? ` ${UNIT[variable]}` : ''}
                </text>
              </g>
            );
          })}
          {hasData && laidEvents.map((e, i) => (
            <g key={i}>
              <line x1={e.x} y1={pad.t} x2={e.x} y2={H - pad.b} className="stroke-amber-400/40" strokeDasharray="3 2" />
              <text x={e.x} y={e.ly} textAnchor="middle" className="fill-amber-400/80 text-[9px]">{t(EVENT_LABEL[e.type])}</text>
            </g>
          ))}
          {hasData && <path d={area} fill="url(#fc-fill)" />}
          {hasData && <path d={line} className="fill-none stroke-sky-400" strokeWidth={2} vectorEffect="non-scaling-stroke" />}
          <text x={pad.l} y={H - 10} className="fill-slate-500 text-[10px]">0 s</text>
          <text x={W - pad.r} y={H - 10} textAnchor="end" className="fill-slate-500 text-[10px] tabular-nums">{fmtNum(maxT, 1)} s</text>
        </svg>
      </div>
    </div>
  );
}
