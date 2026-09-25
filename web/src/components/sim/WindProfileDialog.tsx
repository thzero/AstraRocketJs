import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LaunchConditions, WindLevel } from '../../services/orkTree';
import { NumberInput } from '../common/NumberInput';
import { Dialog } from '../common/Dialog';
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
 *
 * Mounted only while open (`{open && <WindProfileDialog />}`), so the error
 * line and the row keys start fresh per opening.
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
  launch,
  onChange,
  onCommit,
  onClose,
}: {
  launch: LaunchConditions;
  onChange: (patch: Partial<LaunchConditions>) => void;
  onCommit?: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const u = useUnits();
  const fileRef = useRef<HTMLInputElement>(null);
  const [showVectors, setShowVectors] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const levels = launch.windLevels ?? [];
  // A stable key per row. WindLevel carries no id, and keying on the index
  // meant deleting row 1 re-labeled row 2's inputs as row 1 in place: the
  // field being typed into suddenly held the next level's numbers. Rows are
  // added, removed and replaced only through the handlers below, which keep
  // this list aligned with `levels`; an outside change (undo, a fresh
  // profile) shows as a length mismatch and falls back to index keys.
  const [rowIds, setRowIds] = useState<number[]>(() => levels.map((_, i) => i));
  const nextId = () => rowIds.reduce((m, id) => Math.max(m, id), -1) + 1;
  const reference = launch.windAltitudeReference ?? 'msl';
  // The safety codes judge the wind at the pad, so only the ground layer carries
  // the ceiling. Lowest altitude, not the first row: the list is not sorted.
  const surfaceLevel = levels.length
    ? levels.reduce((lowIdx, l, i) => (l.altitudeM < levels[lowIdx]!.altitudeM ? i : lowIdx), 0)
    : -1;

  const setLevels = (next: WindLevel[]) => onChange({ windLevels: next.length ? next : undefined });
  /** Replace the whole profile (import, reset): every row is new. */
  const replaceLevels = (next: WindLevel[]) => {
    const base = nextId();
    setRowIds(next.map((_, i) => base + i));
    setLevels(next);
  };
  const patchLevel = (i: number, p: Partial<WindLevel>) =>
    setLevels(levels.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const removeLevel = (i: number) => {
    setRowIds(rowIds.filter((_, j) => j !== i));
    setLevels(levels.filter((_, j) => j !== i));
  };
  const addLevel = () => {
    const last = levels[levels.length - 1];
    setRowIds([...rowIds, nextId()]);
    setLevels([
      ...levels,
      {
        altitudeM: (last?.altitudeM ?? 0) + 300,
        speed: last?.speed ?? 0,
        directionDeg: last?.directionDeg ?? 90,
        stddev: last?.stddev ?? 0,
      },
    ]);
  };

  const setSpeed = (i: number, speed: number) => {
    const l = levels[i]!;
    // As `LevelWindModel.setSpeed` does (it delegates to `setAverage`): the
    // layer's turbulence stays the fraction it was rather than the m/s it was.
    if (!hasIntensity(l.speed)) return patchLevel(i, { speed });
    patchLevel(i, { speed, stddev: stdDevForIntensity(speed, turbulenceIntensity(l.speed, l.stddev)) });
  };

  const importCsv = async (file: File) => {
    try {
      replaceLevels(parseWindProfileCsv(await file.text()));
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
    <Dialog
      id="windProfile"
      title={t('windProfile.title')}
      onClose={onClose}
      // Opened from the launch panel inside the simulation editor's dialog.
      layer="over"
      size="4xl"
      layout="pad"
    >
      {/* The commit-on-blur sits on a wrapper rather than the panel the shell
          owns. Blur bubbles (React's onBlur is focusout), so every field inside
          still commits when it is left. */}
      <div onBlur={onCommit}>
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_280px]">
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
                const key = rowIds.length === levels.length ? `id-${rowIds[i]}` : `i-${i}`;
                return (
                  <div key={key} className="flex items-center gap-1">
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
                        removeLevel(i);
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
                  addLevel();
                  onCommit?.();
                }}
              >
                {t('windProfile.addLevel')}
              </button>
              <button
                className={btn}
                onClick={() => {
                  replaceLevels([initialLevel()]);
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
    </Dialog>
  );
}
