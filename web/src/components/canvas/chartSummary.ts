import { fmtNum } from '../../i18n/format';

/**
 * The written summaries the charts give a screen reader: what a chart shows,
 * as a sentence, so its numbers are reachable without walking the crosshair
 * sample by sample. Each chart's SVG carries its summary as its accessible
 * name (`role="img"`), and sighted readers see the chart itself.
 *
 * Values arrive already in display units (the chart's own scaling), so a
 * summary reads in the units the chart is drawn in.
 */

/** A translator, narrowed to what these builders call. */
type T = (key: string, options?: Record<string, unknown>) => string;

/** One stage's samples: x (time or Mach) and the plotted y, in display units. */
export interface SummaryStage {
  name: string;
  xs: readonly number[];
  ys: readonly number[];
}

/** The sample of largest magnitude (sign kept) and where it falls, or null for no samples. */
export function peakOf(xs: readonly number[], ys: readonly number[]): { value: number; at: number } | null {
  let best = -1;
  for (let i = 0; i < ys.length; i++) {
    if (best < 0 || Math.abs(ys[i]!) > Math.abs(ys[best]!)) best = i;
  }
  return best < 0 ? null : { value: ys[best]!, at: xs[best]! };
}

/** The smallest and largest sample, or null for no samples. */
export function rangeOf(ys: readonly number[]): { min: number; max: number } | null {
  if (!ys.length) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const y of ys) {
    if (y < min) min = y;
    if (y > max) max = y;
  }
  return { min, max };
}

const withUnit = (v: number, digits: number, unit: string) => `${fmtNum(v, digits)}${unit ? ` ${unit}` : ''}`;

/**
 * What a chart's live region says when the keyboard moves its crosshair: where
 * the crosshair is, then each series' value there ("Altitude 312 m, Velocity
 * 48 m/s"). A series with no value at that point is left out.
 */
export function crosshairReadout(
  at: string,
  items: readonly { label: string; value: number | null; digits: number; unit: string }[],
): string {
  const values = items.flatMap((it) =>
    it.value != null && Number.isFinite(it.value) ? [`${it.label} ${withUnit(it.value, it.digits, it.unit)}`] : [],
  );
  return values.length ? `${at}: ${values.join(', ')}` : at;
}

/** "Booster: …" when there are several stages, the bare part when there is one. */
const perStage = (stages: readonly SummaryStage[], part: (s: SummaryStage) => string): string =>
  stages.length === 1 ? part(stages[0]!) : stages.map((s) => `${s.name}: ${part(s)}`).join('; ');

/**
 * A flight panel against time. A flow series (altitude, velocity, thrust) is
 * summarized by its peak and when it happened; a level series (mass, CG, CP,
 * stability), which changes slowly rather than peaking, by the span it covers.
 */
export function timeSeriesSummary(
  t: T,
  label: string,
  unit: string,
  digits: number,
  level: boolean,
  stages: readonly SummaryStage[],
): string {
  const part = (s: SummaryStage): string => {
    if (level) {
      const r = rangeOf(s.ys);
      return r
        ? t('flight.summaryRange', { min: withUnit(r.min, digits, unit), max: withUnit(r.max, digits, unit) })
        : t('flight.summaryNoData');
    }
    const p = peakOf(s.xs, s.ys);
    return p
      ? t('flight.summaryPeak', { value: withUnit(p.value, digits, unit), time: fmtNum(p.at, 1) })
      : t('flight.summaryNoData');
  };
  return `${label}: ${perStage(stages, part)}`;
}

/**
 * The flight's events in time order, each once. A cluster of stages can carry
 * the same event at the same moment (every booster's burnout at staging), which
 * a reader needs to hear once.
 */
export function eventsSummary(
  t: T,
  events: readonly { type: string; time: number }[],
  eventLabel: (type: string) => string,
): string | null {
  const seen = new Set<string>();
  const items: string[] = [];
  for (const e of [...events].sort((a, b) => a.time - b.time)) {
    const time = fmtNum(e.time, 1);
    const key = `${e.type}@${time}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(t('flight.summaryEventAt', { event: eventLabel(e.type), time }));
  }
  return items.length ? t('flight.summaryEvents', { list: items.join(', ') }) : null;
}

/** The velocity-over-altitude panel: the top speed and the altitude it was reached at. */
export function velocityAltitudeSummary(
  t: T,
  label: string,
  stages: readonly { name: string; alt: readonly number[]; vel: readonly number[] }[],
  fmt: { velocity: (v: number) => string; altitude: (a: number) => string },
): string {
  const part = (s: { alt: readonly number[]; vel: readonly number[] }) => {
    const p = peakOf(s.alt, s.vel);
    return p
      ? t('flight.summaryVelocityAltitude', { velocity: fmt.velocity(p.value), altitude: fmt.altitude(p.at) })
      : t('flight.summaryNoData');
  };
  const list = stages.length === 1 ? part(stages[0]!) : stages.map((s) => `${s.name}: ${part(s)}`).join('; ');
  return `${label}: ${list}`;
}

/** A drag chart against Mach: each curve's peak and the Mach number it occurs at. */
export function machSeriesSummary(
  t: T,
  title: string,
  unit: string,
  digits: number,
  machs: readonly number[],
  series: readonly { name: string; values: readonly number[] }[],
): string {
  const parts = series.map((se) => {
    const xs: number[] = [];
    const ys: number[] = [];
    se.values.forEach((v, i) => {
      if (Number.isFinite(v) && machs[i] != null) {
        xs.push(machs[i]);
        ys.push(v);
      }
    });
    const p = peakOf(xs, ys);
    const text = p
      ? t('aero.summaryPeakMach', { value: withUnit(p.value, digits, unit), mach: fmtNum(p.at, 2) })
      : t('flight.summaryNoData');
    return series.length === 1 ? text : `${se.name}: ${text}`;
  });
  return `${title}: ${parts.join('; ')}`;
}
