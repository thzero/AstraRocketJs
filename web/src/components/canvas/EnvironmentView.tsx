import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useUnits, type FieldUnit } from '../../prefs/useUnits';
import type { Quantity } from '../../prefs/units';
import type { ResultFlight } from '../../services/flight/simulations';
import { WeatherSourceLine } from '../sim/WeatherSourceLine';
import { EnvironmentLanding } from './EnvironmentLanding';
import { TermRow } from '../common/TermRow';
import {
  environmentProfile,
  type EnvironmentQuantity,
  type ProfileLegs,
  type ProfilePoint,
} from '../../services/flight/environmentProfile';
import { formatLat, formatLon } from '../../services/map/slippyMap';
import { fmtSiteTime } from '../../i18n/format';
import { radToDeg } from '../../prefs/units';
import { norm360 } from '../../services/flight/groundTrack';
import { polylinePath } from '../common/svgPath';

/**
 * The air the flight met, as the kernel recorded it: what it was at the pad,
 * and four profiles against altitude. Inputs are on the launch panel; this is
 * what they resolved to, including whatever the run filled in for a blank
 * (the standard atmosphere) and an AGL wind profile turned into real heights.
 */

const QUANTITY: Record<EnvironmentQuantity, Quantity> = {
  windSpeed: 'windspeed',
  windDirection: 'angle',
  temperature: 'temperature',
  pressure: 'pressure',
  density: 'density',
  speedOfSound: 'velocity',
};

/** Below this pad wind (m/s) there is no wind direction to report. */
const CALM_MS = 0.05;

const CHARTS: EnvironmentQuantity[] = ['windSpeed', 'windDirection', 'temperature', 'pressure'];
const PAD: EnvironmentQuantity[] = ['temperature', 'pressure', 'density', 'speedOfSound', 'windSpeed', 'windDirection'];

/** Four significant figures in the field's unit: air density reads 1.225 kg/m³ and 0.001225 g/cm³ alike. */
function sig4(fu: FieldUnit, si: number): string {
  const ui = fu.toUi(si);
  if (!Number.isFinite(ui)) return '—';
  if (ui === 0) return `${fu.fmtSym(si, 0)}`;
  const mag = Math.floor(Math.log10(Math.abs(ui)));
  return `${fu.fmtSym(si, Math.max(0, 3 - mag))}`;
}

export function EnvironmentView({ flight }: { flight: ResultFlight }) {
  const { t } = useTranslation();
  const u = useUnits();
  const env = useMemo(() => environmentProfile(flight.result.series), [flight.result.series]);
  // A run has a date only when its weather came from a forecast for one.
  const source = flight.launch.weatherSource;
  const validAt = source ? fmtSiteTime(source.validAt, source.timezone) : null;
  if (!env) return <p className="p-4 text-sm text-slate-400">{t('env.noData')}</p>;

  const unit = (q: EnvironmentQuantity) => u.plain(QUANTITY[q]);
  const dist = u.plain('distance');
  const show = (q: EnvironmentQuantity, si: number) => {
    if (q !== 'windDirection') return sig4(unit(q), si);
    // Still air has no direction; the recorded angle of a zero vector is not one.
    return env.pad.windSpeed < CALM_MS ? '—' : `${Math.round(compass(si))}°`;
  };

  return (
    <div className="h-full space-y-3 overflow-auto p-2">
      <section className="rounded-xl bg-slate-900 p-3 ring-1 ring-white/10">
        {/* As many columns as fit: one row on a wide screen, wrapped on a phone. */}
        <dl className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-x-4 gap-y-1 text-xs">
          {validAt && <TermRow label={t('env.when')}>{validAt}</TermRow>}
          <TermRow label={t('env.latitude')}>{latText(flight.launch.latitudeDeg)}</TermRow>
          <TermRow label={t('env.longitude')}>{lonText(flight.launch.longitudeDeg)}</TermRow>
          <TermRow label={t('env.elevation')}>{`${dist.fmtSym(flight.launch.launchAltitudeM ?? 0, 0)}`}</TermRow>
          {PAD.map((q) => (
            <TermRow key={q} label={t(`env.q.${q}`)}>
              {show(q, env.pad[q])}
            </TermRow>
          ))}
        </dl>
        {flight.launch.weatherSource && (
          <div className="mt-2">
            <WeatherSourceLine launch={flight.launch} summary={false} />
          </div>
        )}
      </section>
      <EnvironmentLanding flight={flight} />
      <p className="text-xs text-slate-400">{t('env.note', { apogee: sig4(dist, env.apogee) })}</p>
      <div className="grid gap-3 md:grid-cols-2">
        {CHARTS.map((q) => (
          <ProfileChart
            key={q}
            title={t(`env.q.${q}`)}
            legs={env.profiles[q]}
            apogee={env.apogee}
            x={q === 'windDirection' ? DIRECTION_AXIS : unitAxis(unit(q))}
            xSym={q === 'windDirection' ? '°' : unit(q).sym}
            y={dist}
            ascentLabel={t('env.ascent')}
            descentLabel={t('env.descent')}
          />
        ))}
      </div>
    </div>
  );
}

/** A latitude or longitude as the launch panel holds it, to the 4 decimals (about 10 m) it is entered to. */
const latText = (v: number | null) => (v == null ? '—' : formatLat(v));
const lonText = (v: number | null) => (v == null ? '—' : formatLon(v));

/** Radians as compass degrees, 0 to 360. */
const compass = (rad: number) => norm360(radToDeg(rad));

interface XAxis {
  /** SI to the coordinate the chart is laid out in. */
  coord: (si: number) => number;
  /** A coordinate as printed at the axis ends. */
  label: (c: number) => string;
  /** A fixed range in axis values; otherwise the data's own. */
  range?: [number, number];
  /** Where a line jumps by more than this, it is not drawn across the gap. */
  wrap?: number;
}

const DIRECTION_AXIS: XAxis = {
  coord: compass,
  label: (c) => String(Math.round(c)),
  range: [0, 360],
  wrap: 180,
};

/**
 * Laid out in SI: every unit here is a scale or an offset of SI, so the line
 * has the same shape in any of them, and the ends are printed in the user's.
 */
const unitAxis = (fu: FieldUnit): XAxis => ({ coord: (si) => si, label: (si) => fu.fmt(si, 1) });

const W = 320;
const H = 240;
const PAD_L = 46;
const PAD_R = 10;
const PAD_T = 10;
const PAD_B = 30;

function ProfileChart({
  title,
  legs,
  apogee,
  x,
  xSym,
  y,
  ascentLabel,
  descentLabel,
}: {
  title: string;
  legs: ProfileLegs;
  apogee: number;
  x: XAxis;
  xSym: string;
  y: FieldUnit;
  ascentLabel: string;
  descentLabel: string;
}) {
  const all = [...legs.ascent, ...legs.descent].map((p) => x.coord(p.value));
  let [lo, hi] = x.range ?? [Math.min(...all), Math.max(...all)];
  if (!(hi > lo)) {
    // A flat line (still air, or a constant) still needs a width to sit in.
    const pad = Math.abs(lo) * 0.05 || 1;
    lo -= pad;
    hi += pad;
  }
  const top = apogee > 0 ? apogee : 1;
  const px = (v: number) => PAD_L + ((v - lo) / (hi - lo)) * (W - PAD_L - PAD_R);
  const py = (alt: number) => H - PAD_B - (alt / top) * (H - PAD_T - PAD_B);

  const path = (pts: ProfilePoint[]) => {
    const vs = pts.map((p) => x.coord(p.value));
    const jump = (i: number) => i > 0 && x.wrap !== undefined && Math.abs(vs[i]! - vs[i - 1]!) > x.wrap;
    return polylinePath(
      pts.map((p, i) => [px(vs[i]!), py(p.altitude)]),
      'space',
      jump,
    );
  };

  const loUi = x.label(lo);
  const hiUi = x.label(hi);
  const label = `${title}: ${loUi} to ${hiUi} ${xSym}, ground to ${y.fmtSym(apogee, 0)}`;

  return (
    <figure className="rounded-xl bg-slate-900 p-2 ring-1 ring-white/10">
      <figcaption className="flex items-center justify-between px-1 pb-1 text-xs">
        <span className="font-semibold text-slate-300">{title}</span>
        <span className="flex gap-3 text-slate-400">
          <span className="flex items-center gap-1">
            <svg width="16" height="4" aria-hidden="true">
              <line x1="0" y1="2" x2="16" y2="2" className="stroke-sky-400" strokeWidth="2" />
            </svg>
            {ascentLabel}
          </span>
          <span className="flex items-center gap-1">
            <svg width="16" height="4" aria-hidden="true">
              <line x1="0" y1="2" x2="16" y2="2" className="stroke-amber-400" strokeWidth="2" strokeOpacity={0.6} />
            </svg>
            {descentLabel}
          </span>
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={label}>
        <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={H - PAD_B} className="stroke-slate-600" />
        <line x1={PAD_L} y1={H - PAD_B} x2={W - PAD_R} y2={H - PAD_B} className="stroke-slate-600" />
        {/* Thin and faint, under the ascent: a descent under canopy passes the
            same heights for a minute or more while the gusts keep changing, so
            its wind is a dense zigzag that would bury the ascent at full weight. */}
        <path d={path(legs.descent)} fill="none" strokeWidth={0.75} strokeOpacity={0.6} className="stroke-amber-400" />
        <path d={path(legs.ascent)} fill="none" strokeWidth={1.75} className="stroke-sky-400" />
        <text x={PAD_L - 4} y={PAD_T + 8} textAnchor="end" className="fill-slate-400 text-[10px]">
          {y.fmt(apogee, 0)}
        </text>
        <text x={PAD_L - 4} y={H - PAD_B} textAnchor="end" className="fill-slate-400 text-[10px]">
          0
        </text>
        <text x={4} y={(H - PAD_B + PAD_T) / 2} className="fill-slate-500 text-[10px]">
          {y.sym}
        </text>
        <text x={PAD_L} y={H - PAD_B + 13} textAnchor="start" className="fill-slate-400 text-[10px]">
          {loUi}
        </text>
        <text x={W - PAD_R} y={H - PAD_B + 13} textAnchor="end" className="fill-slate-400 text-[10px]">
          {hiUi}
        </text>
        <text x={(PAD_L + W - PAD_R) / 2} y={H - 4} textAnchor="middle" className="fill-slate-500 text-[10px]">
          {xSym}
        </text>
      </svg>
    </figure>
  );
}
