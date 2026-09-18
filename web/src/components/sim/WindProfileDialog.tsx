import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LaunchConditions, WindLevel } from '../../services/orkTree';
import { NumberInput } from '../common/NumberInput';
import { useFocusTrap } from '../common/useFocusTrap';
import { useUnits, type Units } from '../../prefs/useUnits';
import { MAX_WIND_SPEED_MS } from '../../services/safetyLimits';
import { hasIntensity, stdDevForIntensity, turbulenceIntensity, turbulenceLevel } from '../../services/windTurbulence';
import { parseWindProfileCsv, WindProfileCsvError } from '../../services/windProfileCsv';

/**
 * The altitude-layered wind profile, as OpenRocket's Wind Profile Editor: one
 * row per level carrying altitude, speed, direction, standard deviation AND the
 * same deviation read as a turbulence percentage with its descriptive name,
 * plus the MSL/AGL reference the whole profile is measured against.
 *
 * It is a dialog rather than the launch panel's inline grid because the grid
 * could not hold the columns. That was the reason turbulence was missing here
 * while the single-wind panel had it, which is exactly backwards: a profile is
 * where per-layer gustiness has something to say.
 */

/** A default level, matching the kernel's `addInitialLevel` (still air at the pad). */
const initialLevel = (): WindLevel => ({ altitudeM: 0, speed: 0, directionDeg: 90, stddev: 0 });

const cell = 'rounded bg-slate-800 px-1 py-1 text-right text-xs tabular-nums text-slate-100 ring-1 ring-white/10';
const btn =
  'rounded-md bg-slate-800 px-2 py-1.5 text-xs font-medium text-slate-300 ring-1 ring-white/10 hover:bg-slate-700';

/**
 * Altitude against wind speed, the way the desktop draws it: altitude up, speed
 * across, one marker per level. The direction vectors are optional because on a
 * profile whose layers back round they are the whole point, and on a profile
 * that blows one way throughout they are noise.
 */
function ProfileChart({ levels, u, showVectors }: { levels: WindLevel[]; u: Units; showVectors: boolean }) {
  const W = 260;
  const H = 240;
  const padL = 44;
  const padR = 16;
  const padT = 12;
  const padB = 36;

  const speeds = levels.map((l) => u.toUi('windspeed', l.speed));
  const alts = levels.map((l) => u.toUi('distance', l.altitudeM));
  // A flat profile (one level, or every level alike) has a zero span, which
  // would put every point on one edge or divide by zero. Pad it to a real range.
  const sMax = Math.max(...speeds, 0);
  const aMin = Math.min(...alts, 0);
  const aMax = Math.max(...alts, 0);
  const sHi = sMax > 0 ? sMax * 1.2 : 1;
  const aSpan = aMax - aMin;
  const aHi = aSpan > 0 ? aMax + aSpan * 0.1 : aMin + 1;

  const X = (s: number) => padL + (s / sHi) * (W - padL - padR);
  const Y = (a: number) => H - padB - ((a - aMin) / (aHi - aMin)) * (H - padT - padB);

  const pts = levels
    .map((l, i) => ({ x: X(speeds[i]!), y: Y(alts[i]!), dir: l.directionDeg }))
    .sort((a, b) => b.y - a.y);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-hidden="true">
      <line x1={padL} y1={padT} x2={padL} y2={H - padB} stroke="currentColor" className="text-slate-600" />
      <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke="currentColor" className="text-slate-600" />
      {pts.length > 1 && (
        <path
          d={pts.map((p, i) => `${i ? 'L' : 'M'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          className="text-sky-500"
        />
      )}
      {pts.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r={3} className="fill-sky-400" />
          {showVectors && (
            // Screen-space: 0 degrees points up the page, and the arrow shows
            // the heading the layer's wind is described by.
            <g transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)}) rotate(${p.dir})`}>
              <line x1={0} y1={0} x2={0} y2={-14} stroke="currentColor" strokeWidth={1} className="text-sky-300" />
              <path d="M -2.5 -10 L 0 -15 L 2.5 -10 Z" className="fill-sky-300" />
            </g>
          )}
        </g>
      ))}
      <text x={4} y={padT + 8} className="fill-slate-500 text-[9px]">
        {u.sym('distance')}
      </text>
      <text x={W - padR} y={H - 6} textAnchor="end" className="fill-slate-500 text-[9px]">
        {u.sym('windspeed')}
      </text>
      <text x={padL} y={H - padB + 12} textAnchor="middle" className="fill-slate-500 text-[9px]">
        0
      </text>
      <text x={W - padR} y={H - padB + 12} textAnchor="end" className="fill-slate-500 text-[9px]">
        {sHi.toFixed(sHi < 10 ? 1 : 0)}
      </text>
    </svg>
  );
}

export function WindProfileDialog({
  open,
  launch,
  onChange,
  onCommit,
  onClose,
}: {
  open: boolean;
  launch: LaunchConditions;
  onChange: (patch: Partial<LaunchConditions>) => void;
  onCommit?: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const u = useUnits();
  const panelRef = useFocusTrap<HTMLDivElement>(open);
  const fileRef = useRef<HTMLInputElement>(null);
  const [showVectors, setShowVectors] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const levels = launch.windLevels ?? [];
  const reference = launch.windAltitudeReference ?? 'msl';
  // The safety codes judge the wind at the pad, so only the ground layer carries
  // the ceiling. Lowest altitude, not the first row: the list is not sorted.
  const surfaceLevel = levels.length
    ? levels.reduce((lowIdx, l, i) => (l.altitudeM < levels[lowIdx]!.altitudeM ? i : lowIdx), 0)
    : -1;

  const setLevels = (next: WindLevel[]) => onChange({ windLevels: next.length ? next : undefined });
  const patchLevel = (i: number, p: Partial<WindLevel>) =>
    setLevels(levels.map((l, j) => (j === i ? { ...l, ...p } : l)));

  const setSpeed = (i: number, speed: number) => {
    const l = levels[i]!;
    // As `LevelWindModel.setSpeed` does (it delegates to `setAverage`): the
    // layer's turbulence stays the fraction it was rather than the m/s it was.
    if (!hasIntensity(l.speed)) return patchLevel(i, { speed });
    patchLevel(i, { speed, stddev: stdDevForIntensity(speed, turbulenceIntensity(l.speed, l.stddev)) });
  };

  const importCsv = async (file: File) => {
    try {
      setLevels(parseWindProfileCsv(await file.text()));
      setError(null);
      onCommit?.();
    } catch (e) {
      // Import REPLACES the profile, so a bad file must leave it untouched:
      // parse throws before anything is set rather than half-applying.
      setError(
        e instanceof WindProfileCsvError
          ? t(`windProfile.csv.${e.key}`, { line: e.line })
          : t('windProfile.csv.unreadable'),
      );
    }
  };

  return (
    <div className="dialog-overlay fixed inset-0 z-[60] grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div
        ref={panelRef}
        className="dialog-panel w-full max-w-4xl rounded-2xl bg-slate-900 p-6 ring-1 ring-white/10"
        role="dialog"
        aria-modal="true"
        aria-label={t('windProfile.title')}
        onClick={(e) => e.stopPropagation()}
        onBlur={onCommit}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-100">{t('windProfile.title')}</h2>
          <button
            onClick={onClose}
            aria-label={t('common.close')}
            className="shrink-0 rounded-lg bg-slate-800 px-2 py-1 text-sm text-slate-300 ring-1 ring-white/10 hover:bg-slate-700"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_280px]">
          <div className="min-w-0">
            <div className="flex gap-1 px-1 pb-1 text-[10px] uppercase tracking-wide text-slate-500">
              <span className="w-20">
                {t('windProfile.altitude')} {t(`windProfile.${reference}Short`)} ({u.sym('distance')})
              </span>
              <span className="w-16">
                {t('launch.speed')} ({u.sym('windspeed')})
              </span>
              <span className="w-14">{t('launch.direction')} (°)</span>
              <span className="w-16">
                {t('windProfile.deviation')} ({u.sym('windspeed')})
              </span>
              <span className="w-14">{t('windProfile.turbulence')} (%)</span>
              <span className="w-20">{t('windProfile.intensity')}</span>
              <span className="w-6" />
            </div>

            {!levels.length && <p className="px-1 py-3 text-xs text-slate-500">{t('windProfile.noLevels')}</p>}

            <div className="max-h-[320px] space-y-1 overflow-y-auto">
              {levels.map((l, i) => {
                const intensity = turbulenceIntensity(l.speed, l.stddev);
                return (
                  <div key={i} className="flex items-center gap-1">
                    <NumberInput
                      step={u.step('distance', 50)}
                      min={0}
                      ariaLabel={`${t('windProfile.altitude')} ${i + 1}`}
                      value={u.toUi('distance', l.altitudeM)}
                      onChange={(v) => patchLevel(i, { altitudeM: u.fromUi('distance', v ?? 0) })}
                      className={`${cell} w-20`}
                    />
                    <NumberInput
                      step={u.step('windspeed', 0.5)}
                      min={0}
                      max={i === surfaceLevel ? u.toUi('windspeed', MAX_WIND_SPEED_MS) : undefined}
                      ariaLabel={`${t('launch.speed')} ${i + 1}`}
                      value={u.toUi('windspeed', l.speed)}
                      onChange={(v) => setSpeed(i, u.fromUi('windspeed', v ?? 0))}
                      className={`${cell} w-16`}
                    />
                    <NumberInput
                      step={u.step('angle', (5 * Math.PI) / 180)}
                      ariaLabel={`${t('launch.direction')} ${i + 1}`}
                      value={u.toUi('angle', (l.directionDeg * Math.PI) / 180)}
                      onChange={(v) => patchLevel(i, { directionDeg: (u.fromUi('angle', v ?? 0) * 180) / Math.PI })}
                      className={`${cell} w-14`}
                    />
                    <NumberInput
                      step={u.step('windspeed', 0.5)}
                      min={0}
                      ariaLabel={`${t('windProfile.deviation')} ${i + 1}`}
                      value={u.toUi('windspeed', l.stddev)}
                      onChange={(v) => patchLevel(i, { stddev: u.fromUi('windspeed', v ?? 0) })}
                      className={`${cell} w-16`}
                    />
                    <NumberInput
                      step={1}
                      min={0}
                      ariaLabel={`${t('windProfile.turbulence')} ${i + 1}`}
                      value={Math.round(intensity * 100)}
                      onChange={(v) => patchLevel(i, { stddev: stdDevForIntensity(l.speed, (v ?? 0) / 100) })}
                      className={`${cell} w-14`}
                    />
                    <span className="w-20 truncate text-[11px] text-slate-400">
                      {t(`launch.turbulenceLevel.${turbulenceLevel(intensity)}`)}
                    </span>
                    <button
                      onClick={() => {
                        setLevels(levels.filter((_, j) => j !== i));
                        onCommit?.();
                      }}
                      title={t('launch.removeLevel')}
                      aria-label={`${t('launch.removeLevel')} ${i + 1}`}
                      className="w-6 rounded bg-red-500/15 py-1 text-xs text-red-300 ring-1 ring-red-500/30"
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                className={btn}
                onClick={() => {
                  const last = levels[levels.length - 1];
                  setLevels([
                    ...levels,
                    {
                      altitudeM: (last?.altitudeM ?? 0) + 300,
                      speed: last?.speed ?? 0,
                      directionDeg: last?.directionDeg ?? 90,
                      stddev: last?.stddev ?? 0,
                    },
                  ]);
                  onCommit?.();
                }}
              >
                {t('windProfile.addLevel')}
              </button>
              <button
                className={btn}
                onClick={() => {
                  setLevels([initialLevel()]);
                  setError(null);
                  onCommit?.();
                }}
              >
                {t('windProfile.resetLevels')}
              </button>
              <button className={btn} onClick={() => fileRef.current?.click()}>
                {t('windProfile.importLevels')}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  // Cleared so re-picking the same file fires change again.
                  e.target.value = '';
                  if (f) void importCsv(f);
                }}
              />
            </div>
            <p className="mt-1 text-[11px] leading-snug text-slate-500">{t('windProfile.csvFormat')}</p>
            {error && (
              <p role="alert" className="mt-1 text-[11px] leading-snug text-red-300">
                {error}
              </p>
            )}
          </div>

          <div className="min-w-0">
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
              {t('windProfile.visualization')}
            </h3>
            <div className="rounded-lg bg-slate-950/40 p-2 ring-1 ring-white/5">
              <ProfileChart levels={levels} u={u} showVectors={showVectors} />
            </div>
            <label className="mt-2 flex items-center gap-2">
              <input
                type="checkbox"
                checked={showVectors}
                onChange={(e) => setShowVectors(e.target.checked)}
                className="accent-sky-500"
              />
              <span className="text-xs text-slate-400">{t('windProfile.showVectors')}</span>
            </label>

            <fieldset className="mt-4">
              <legend className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                {t('windProfile.altitudeReference')}
              </legend>
              <div className="mt-1 space-y-1">
                {(['msl', 'agl'] as const).map((r) => (
                  <label key={r} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="windAltitudeReference"
                      checked={reference === r}
                      onChange={() => {
                        onChange({ windAltitudeReference: r });
                        onCommit?.();
                      }}
                      className="accent-sky-500"
                    />
                    <span className="text-xs text-slate-400">{t(`windProfile.${r}`)}</span>
                  </label>
                ))}
              </div>
              <p className="mt-1 text-[11px] leading-snug text-slate-500">{t('windProfile.referenceNote')}</p>
            </fieldset>
          </div>
        </div>

        <div className="mt-5 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500"
          >
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
