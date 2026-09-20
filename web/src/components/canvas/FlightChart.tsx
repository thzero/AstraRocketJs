import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fmtNum } from '../../i18n/format';
import { EVENT_LABEL, clusterEventLabels } from '../../services/simReport';
import { FlightCsvDialog } from '../sim/FlightCsvDialog';
import { useSettings } from '../../state/SettingsProvider';
import { PAD_L, PAD_R, maxFlightTime } from './flightChartAxis';
import { SERIES, buildTraces, visibleSeries, type ChartFlight, type Key } from './flightChartTraces';
import { useChartZoom } from './useChartZoom';
import { useChartCrosshair } from './useChartCrosshair';
import { EventLabelStrip, eventStripHeight, packEventLabels } from './FlightChartEvents';
import { FlightChartPanel } from './FlightChartPanel';

// The series catalog and the axis math moved to their own modules; CenterView,
// GroundTrack and the chart tests import them from here.
export { buildTraces, visibleSeries, type ChartFlight } from './flightChartTraces';
export { maxFlightTime } from './flightChartAxis';

/**
 * Flight data as SMALL MULTIPLES (mmrocket-style): time on a shared x, and one
 * stacked single-series panel per measure — each with its OWN y-scale, because
 * measures of different magnitude are never dual-axed. A chip bar toggles which
 * panels show; a single hover drives a synchronized crosshair + value readout
 * across every visible panel. All eleven series already ride in on every sim run.
 * The x (time) axis zooms/pans (buttons, drag, ctrl/pinch-wheel); a sticky strip
 * up top row-packs the event labels so they never overlap.
 *
 * This file is the composition: the series catalog (flightChartTraces.ts),
 * the axis and window math (flightChartAxis.ts), the zoom/pan interaction
 * (useChartZoom.ts), the crosshair (useChartCrosshair.ts), the event strip
 * (FlightChartEvents.tsx) and the panel (FlightChartPanel.tsx) each live in
 * their own module.
 */
export function FlightChart({ flight }: { flight: ChartFlight }) {
  const { t } = useTranslation();
  // Which panels are open, remembered between visits (services/settings.ts).
  // It used to be component state seeded from a constant, so anyone who worked
  // with thrust or mass re-ticked them every time the Results tab was opened.
  const { settings, update } = useSettings();
  const on = useMemo(() => visibleSeries(settings.flightSeries), [settings.flightSeries]);
  const [csvOpen, setCsvOpen] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(640);

  // Every branch as a colored, selectable trace.
  const branches = useMemo(() => buildTraces(flight, (i) => `${t('flight.stage')} ${i + 1}`), [flight, t]);
  const multistage = branches.length >= 2;

  // Which traces are HIDDEN. Exclusions rather than inclusions: a new set of
  // stages is all shown by construction (none of its keys is in the set), so
  // no effect has to reset the selection when the flight changes, and there is
  // no first frame drawn with a stale list. The last shown stage cannot be
  // hidden (nothing to plot otherwise).
  const [offStages, setOffStages] = useState<ReadonlySet<string>>(() => new Set());
  const isOn = (k: string) => !offStages.has(k);
  const toggleStage = (k: string) =>
    setOffStages((cur) => {
      const next = new Set(cur);
      if (next.has(k)) next.delete(k);
      else if (branches.filter((b) => !next.has(b.key)).length > 1) next.add(k);
      return next;
    });
  // Stable across hover re-renders so the panels don't recompute their paths on
  // every pointer move (the memo below keys on this reference).
  const selectedBranches = useMemo(() => branches.filter((b) => !offStages.has(b.key)), [branches, offStages]);

  // x-axis spans every branch, so a booster that lands after the sustainer still
  // fits (its own descent runs on the same launch clock).
  // Memoized: hovering sets state, so the render body runs on every pointer
  // move and this must not walk every sample again each time.
  const maxT = useMemo(
    () => maxFlightTime(branches, flight.result.summary.flightTime),
    [branches, flight.result.summary.flightTime],
  );

  const iw = w - PAD_L - PAD_R;
  const zoomCtl = useChartZoom(hostRef, maxT, iw);
  const { t0, t1, zoomed, X, invX, localX, zoomAt } = zoomCtl;
  const crosshair = useChartCrosshair(t0, t1);
  const { hoverT, setHoverT } = crosshair;

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setW(Math.max(280, entries[0]!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const centerT = () => hoverT ?? (t0 + t1) / 2;

  // Events of every shown stage (a spent booster carries its own apogee, deploy
  // and ground-hit). De-selecting a stage drops its markers too.
  const events = useMemo(
    () => selectedBranches.flatMap((b) => b.events).filter((e) => EVENT_LABEL[e.type] && e.time <= maxT),
    [selectedBranches, maxT],
  );

  // Boost→apogee window: aero series (CP / stability) are only meaningful until
  // the rocket stops flying forward (recovery deploy, else apogee).
  const clipT = useMemo(() => {
    const at = (type: string) => flight.result.events?.find((e) => e.type === type)?.time;
    return (
      at('RECOVERY_DEVICE_DEPLOYMENT') ??
      at('EJECTION_CHARGE') ??
      at('APOGEE') ??
      flight.result.summary.timeToApogee ??
      maxT
    );
  }, [flight, maxT]);

  // Cluster near-coincident event labels (a recovery deployment always keeps its
  // own marker), drop any outside the visible window, then row-pack them.
  const eventLabels = useMemo(() => {
    const labelW = (type: string) => t(EVENT_LABEL[type] ?? type).length * 5.2 + 10;
    return packEventLabels(clusterEventLabels(events, X), w, labelW);
    // `X` is the memoized time-to-px map and already changes with the window
    // (t0, t1) and the width, so listing it is both honest and sufficient.
  }, [events, X, w, t]);
  const stripH = eventStripHeight(eventLabels);

  const toggle = (k: Key) => update({ flightSeries: on.includes(k) ? on.filter((x) => x !== k) : [...on, k] });
  const activeMetas = SERIES.filter((m) => on.includes(m.key));

  // Pointer: drag pans (only when zoomed in); otherwise it drives the hover crosshair.
  const onDown = (e: React.PointerEvent) => {
    if (zoomCtl.startPan(e)) setHoverT(null);
  };
  const onMove = (e: React.PointerEvent) => {
    if (zoomCtl.pan(e)) return;
    setHoverT(crosshair.clampT(invX(localX(e.clientX))));
  };

  const zBtn =
    'rounded-md bg-slate-800 px-2 py-1 text-[11px] font-medium text-slate-200 ring-1 ring-white/10 hover:bg-slate-700 disabled:opacity-40';

  return (
    <div className="flex h-full flex-col rounded-xl bg-slate-900 ring-1 ring-white/10">
      <div className="flex items-center justify-between gap-2 px-3 pt-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t('flight.title')}</h2>
        <div className="flex items-center gap-2">
          <span className="text-xs tabular-nums text-slate-400" aria-live="polite">
            {t('flight.time')} {fmtNum(hoverT ?? maxT, hoverT != null ? 2 : 1)} s
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => zoomAt(1 / 0.6, centerT())}
              disabled={!zoomed}
              title={t('flight.zoomOut')}
              aria-label={t('flight.zoomOut')}
              className={zBtn}
            >
              −
            </button>
            <button
              onClick={() => zoomAt(0.6, centerT())}
              title={t('flight.zoomIn')}
              aria-label={t('flight.zoomIn')}
              className={zBtn}
            >
              +
            </button>
            <button
              onClick={zoomCtl.reset}
              disabled={!zoomed}
              title={t('flight.zoomReset')}
              aria-label={t('flight.zoomReset')}
              className={zBtn}
            >
              ⤢
            </button>
          </div>
          <button
            onClick={() => setCsvOpen(true)}
            title={t('flight.exportCsv')}
            className="rounded-md bg-slate-800 px-2 py-1 text-[11px] font-medium text-slate-200 ring-1 ring-white/10 hover:bg-slate-700"
          >
            ⬇ CSV
          </button>
        </div>
      </div>
      {multistage && (
        <div className="flex flex-wrap items-center gap-1.5 px-3 pt-2">
          <span className="mr-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            {t('flight.stages')}
          </span>
          {branches.map((b) => {
            const active = isOn(b.key);
            return (
              <button
                key={b.key}
                onClick={() => toggleStage(b.key)}
                aria-pressed={active}
                className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ${active ? 'bg-slate-700 text-slate-100 ring-white/20' : 'bg-slate-800 text-slate-400 ring-white/10'}`}
              >
                <span
                  className="inline-block h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: b.color, opacity: active ? 1 : 0.4 }}
                />
                {b.name}
              </button>
            );
          })}
        </div>
      )}
      <div className="flex flex-wrap gap-1.5 px-3 py-2">
        {SERIES.map((m) => {
          const active = on.includes(m.key);
          return (
            <button
              key={m.key}
              onClick={() => toggle(m.key)}
              aria-pressed={active}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ${active ? 'bg-sky-600 text-white ring-sky-500' : 'bg-slate-800 text-slate-300 ring-white/10'}`}
            >
              {t(m.label)}
            </button>
          );
        })}
      </div>
      {/*
        The crosshair was pointer-only: hoverT's single setter was onPointerMove
        on a plain div, so every number these charts carry was unreachable
        without a mouse. Focusable, with the arrows stepping it — Shift for a
        coarse step, Home/End for the ends, Escape to drop it. The readout above
        is a live region, so the value is announced as it moves.
      */}
      <div
        ref={hostRef}
        tabIndex={0}
        role="group"
        aria-label={t('flight.crosshairHint')}
        className={`min-h-0 flex-1 overflow-y-auto px-3 pb-3 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-inset focus-visible:outline-none ${zoomed ? 'cursor-grab' : ''}`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={zoomCtl.endPan}
        onPointerCancel={zoomCtl.endPan}
        onFocus={crosshair.onFocus}
        onBlur={crosshair.onBlur}
        onKeyDown={crosshair.onKeyDown}
        onPointerLeave={() => {
          if (!zoomCtl.isPanning()) setHoverT(null);
        }}
      >
        {activeMetas.length === 0 ? (
          <p className="grid h-full place-items-center text-sm text-slate-500">{t('flight.pickSeries')}</p>
        ) : (
          <>
            {stripH > 0 && <EventLabelStrip labels={eventLabels} w={w} stripH={stripH} t={t} />}
            {activeMetas.map((m) => (
              <FlightChartPanel
                key={m.key}
                meta={m}
                branches={selectedBranches}
                w={w}
                X={X}
                hoverT={hoverT}
                clipT={clipT}
                events={events}
              />
            ))}
          </>
        )}
      </div>
      {csvOpen && <FlightCsvDialog result={flight.result} simName={flight.name} onClose={() => setCsvOpen(false)} />}
    </div>
  );
}
