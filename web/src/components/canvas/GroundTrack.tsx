import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUnits } from '../../prefs/useUnits';
import { unitScope } from '../../prefs/units';
import { fmtNum } from '../../i18n/format';
import { groundTrackLine, rangeRings, trackExtent, type GroundTrackLine } from '../../services/groundTrack';
import { buildTraces, type ChartFlight } from './FlightChart';

/**
 * The flight from directly above: the path over the ground, the pad at the
 * center, and where it came down.
 *
 * North is up and the scale is the same on both axes, because this is read as a
 * map of the field you are standing on — stretching one axis would bend a
 * straight drift into a curve and turn a circle of equal distance into an
 * ellipse. Range rings carry the measurement; without them a drift is a
 * squiggle rather than "180 m that way".
 *
 * It draws the same traces the flight charts do, so a staged flight shows each
 * stage's own descent — which is the case where this earns its place, since a
 * spent booster usually lands somewhere quite different from the sustainer.
 */
export function GroundTrack({ flight }: { flight: ChartFlight }) {
  const { t } = useTranslation();
  const u = useUnits();
  const hostRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(420);

  // Share the chart's unit scope, so a drift read in feet on one view reads in
  // feet on the other.
  const dist = u.at(unitScope('sim', 'apogee'), 'distance');

  const lines = useMemo<GroundTrackLine[]>(
    () =>
      buildTraces(flight, (i) => `${t('flight.stage')} ${i + 1}`).map((tr) =>
        groundTrackLine(tr.key, tr.name, tr.color, tr.series),
      ),
    [flight, t],
  );
  const drawn = lines.filter((l) => l.points.length >= 2);
  const extent = useMemo(() => trackExtent(lines), [lines]);
  const rings = useMemo(() => rangeRings(extent), [extent]);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]!.contentRect;
      setSize(Math.max(200, Math.min(r.width, r.height)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Pad at the center; +north is up (SVG y grows downward, hence the negation).
  const half = size / 2;
  const pad = 18;
  const scale = (half - pad) / extent;
  const X = (east: number) => half + east * scale;
  const Y = (north: number) => half - north * scale;

  // `toUi` rather than a raw factor: the field unit owns the conversion, and a
  // distance carries no temperature-style offset to worry about either way.
  const fmtDist = (m: number) => {
    const v = dist.toUi(m);
    return `${fmtNum(v, Math.abs(v) >= 100 ? 0 : 1)} ${dist.sym}`;
  };

  return (
    <div ref={hostRef} className="flex h-full w-full flex-col items-center justify-center gap-2 overflow-hidden">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={t('flight.groundTrackLabel')}
        className="shrink-0"
      >
        {/* Range rings, outermost first so their labels sit under the tracks. */}
        {rings.map((r) => (
          <g key={r}>
            <circle cx={half} cy={half} r={r * scale} fill="none" className="stroke-white/10" />
            <text x={half + 3} y={Y(r) + 10} className="fill-slate-500 text-[9px] tabular-nums">
              {fmtDist(r)}
            </text>
          </g>
        ))}
        {/* Cardinal cross, and N so the drawing cannot be read upside down. */}
        <line x1={pad} y1={half} x2={size - pad} y2={half} className="stroke-white/10" />
        <line x1={half} y1={pad} x2={half} y2={size - pad} className="stroke-white/10" />
        <text x={half} y={pad - 4} textAnchor="middle" className="fill-slate-400 text-[10px] font-semibold">
          {t('flight.north')}
        </text>

        {drawn.map((l) => (
          <polyline
            key={l.key}
            points={l.points.map((p) => `${X(p.east).toFixed(1)},${Y(p.north).toFixed(1)}`).join(' ')}
            fill="none"
            stroke={l.color}
            strokeWidth={1.75}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {/* Landing marker per track: a ring, so it reads as a place rather than
            as another sample on the line. */}
        {drawn.map((l) =>
          l.landing ? (
            <circle
              key={`${l.key}-end`}
              cx={X(l.landing.east)}
              cy={Y(l.landing.north)}
              r={4}
              fill="none"
              stroke={l.color}
              strokeWidth={2}
            />
          ) : null,
        )}
        {/* The pad, drawn last so it is never buried under a track. */}
        <circle cx={half} cy={half} r={3.5} className="fill-slate-200" />
      </svg>

      {/* Distance and bearing per track: the two numbers you actually act on. */}
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 px-3 pb-1">
        {drawn.map((l) => (
          <span key={l.key} className="flex items-center gap-1.5 text-[11px] text-slate-300">
            <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: l.color }} />
            {/* The name in an element of its own rather than a bare text node,
                so it can be read (and matched) apart from the figures beside it. */}
            <span>{l.name}</span>
            <span className="tabular-nums text-slate-400">
              {fmtDist(l.distance)} · {fmtNum(l.bearing, 0)}°
            </span>
          </span>
        ))}
        {!drawn.length && <span className="text-[11px] text-slate-500">{t('flight.groundTrackEmpty')}</span>}
      </div>
    </div>
  );
}
