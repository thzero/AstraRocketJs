import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LaunchConditions, WindLevel } from '../../services/design/orkTree';
import { NumberInput } from '../common/NumberInput';
import { markRing } from '../common/FieldMark';
import { Dialog } from '../common/Dialog';
import { useUnits, type Units } from '../../prefs/useUnits';
import { onSi } from '../../prefs/entryValue';
import { MAX_TURBULENCE_PERCENT, MAX_WIND_SPEED_MS } from '../../services/flight/safetyLimits';
import {
  retuneStdDev,
  stdDevForIntensity,
  turbulenceIntensity,
  turbulenceLevel,
} from '../../services/flight/windTurbulence';
import { parseWindProfileCsv, WindProfileCsvError } from '../../services/flight/windProfileCsv';
import { duplicateAltitudeRows } from '../../services/flight/windLevels';
import { useLatest } from '../common/useLatest';
import { fmtNum } from '../../i18n/format';
import { readFileText } from '../../services/files/decodeText';
import { degToRad, radToDeg } from '../../prefs/units';
import { DEFAULT_HEADING_DEG } from '../../services/flight/simulations';
import { Check } from '../common/Check';
import { useFilePick } from '../common/useFilePick';
import { polylinePath } from '../common/svgPath';

/**
 * The altitude-layered wind profile, as OpenRocket's Wind Profile Editor: one
 * row per level carrying altitude, speed, direction, standard deviation and the
 * same deviation read as a turbulence percentage with its descriptive name,
 * plus the MSL/AGL reference the whole profile is measured against.
 *
 * It is a dialog rather than an inline grid in the launch panel because the
 * panel cannot hold the columns, and turbulence belongs in a profile: it is
 * where per-layer gustiness has something to say.
 *
 * Mounted only while open (`{open && <WindProfileDialog />}`), so the error
 * line and the row keys start fresh per opening.
 */

/** A default level, matching the kernel's `addInitialLevel` (still air at the pad). */
const initialLevel = (): WindLevel => ({ altitudeM: 0, speed: 0, directionDeg: DEFAULT_HEADING_DEG, stddev: 0 });

const cell = 'rounded bg-raised px-1 py-1 text-right text-xs tabular-nums text-ink-strong ring-1 ring-line/10';
const btn = 'rounded-md bg-raised px-2 py-1.5 text-xs font-medium text-ink-soft ring-1 ring-line/10 hover:bg-elevated';

/**
 * Altitude against wind speed, the way the desktop draws it: altitude up, speed
 * across, one marker per level. The direction vectors are optional because on a
 * profile whose layers back round they carry the information, and on a profile
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
    // Hidden from assistive tech: it pictures the levels the editable rows
    // already list, so announcing it would read them twice.
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" aria-hidden="true">
      <line x1={padL} y1={padT} x2={padL} y2={H - padB} stroke="currentColor" className="text-ink-dim" />
      <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke="currentColor" className="text-ink-dim" />
      {pts.length > 1 && (
        <path
          d={polylinePath(pts.map((p) => [p.x, p.y]))}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          className="text-accent-500"
        />
      )}
      {pts.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r={3} className="fill-accent-400" />
          {showVectors && (
            // Screen-space: 0 degrees points up the page, and the arrow shows
            // the heading the layer's wind is described by.
            <g transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)}) rotate(${p.dir})`}>
              <line x1={0} y1={0} x2={0} y2={-14} stroke="currentColor" strokeWidth={1} className="text-accent-300" />
              <path d="M -2.5 -10 L 0 -15 L 2.5 -10 Z" className="fill-accent-300" />
            </g>
          )}
        </g>
      ))}
      <text x={4} y={padT + 8} className="fill-ink-faint text-[9px]">
        {u.sym('distance')}
      </text>
      <text x={W - padR} y={H - 6} textAnchor="end" className="fill-ink-faint text-[9px]">
        {u.sym('windspeed')}
      </text>
      <text x={padL} y={H - padB + 12} textAnchor="middle" className="fill-ink-faint text-[9px]">
        0
      </text>
      <text x={W - padR} y={H - padB + 12} textAnchor="end" className="fill-ink-faint text-[9px]">
        {fmtNum(sHi, sHi < 10 ? 1 : 0)}
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
  const [showVectors, setShowVectors] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Which CSV import is current: a file read outlives this dialog.
  const csvImport = useLatest();

  const levels = launch.windLevels ?? [];
  // A stable key per row. WindLevel carries no id, and keying on the index
  // would make deleting row 1 re-label row 2's inputs as row 1 in place: the
  // field being typed into would suddenly hold the next level's numbers. Rows are
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
  /**
   * The rows sharing an altitude with an earlier row. The kernel refuses a
   * profile like that outright, in its own words, half way into a run
   * (`Wind level already exists for altitude: 0.0`), so the editor that let it
   * be typed is where it has to be said. Flagged rather than prevented: a row
   * passes through a collision on the way to a legal value - clearing 300 to
   * type 3000 goes past 0 - and refusing the keystroke would make the column
   * unusable.
   */
  const dupeRows = new Set(duplicateAltitudeRows(levels));

  const setLevels = (next: WindLevel[]) => onChange({ windLevels: next.length ? next : undefined });
  /** Replace the whole profile (import, reset): every row is new. */
  const replaceLevels = (next: WindLevel[]) => {
    const base = nextId();
    setRowIds(next.map((_, i) => base + i));
    setLevels(next);
  };
  /**
   * Edit one level, dropping a value that is not a real number.
   *
   * The four columns convert through `onSi` (prefs/entryValue), which already
   * refuses a value that cannot survive the conversion (1e306 ft of altitude
   * is Infinity meters, which the level, the chart, the .ork and the kernel's
   * wind model have no answer for). This stays as the net for the values this
   * function is handed from somewhere other than a box:
   * `setSpeed` recomputes a level's deviation from its own turbulence ratio.
   */
  const patchLevel = (i: number, p: Partial<WindLevel>) => {
    if (Object.values(p).some((v) => !Number.isFinite(v))) return;
    setLevels(levels.map((l, j) => (j === i ? { ...l, ...p } : l)));
  };
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
        // 300 m above the highest level, not above the last row: the list is not
        // sorted, so on a profile of 0/600/300 the last row's +300 lands on 600
        // and collides with an existing level.
        altitudeM: Math.max(0, ...levels.map((l) => l.altitudeM)) + 300,
        speed: last?.speed ?? 0,
        directionDeg: last?.directionDeg ?? DEFAULT_HEADING_DEG,
        stddev: last?.stddev ?? 0,
      },
    ]);
  };

  const setSpeed = (i: number, speed: number) => {
    const l = levels[i]!;
    // As `LevelWindModel.setSpeed` does (it delegates to `setAverage`): the
    // layer's turbulence stays the fraction it was rather than the m/s it was.
    patchLevel(i, { speed, stddev: retuneStdDev(l.speed, l.stddev, speed) });
  };

  const importCsv = async (file: File) => {
    // Reading the file is a read that resolves after the fact, and
    // `replaceLevels` writes to whatever simulations are the current edit
    // targets. Closing this dialog, or picking a second file, must not let the
    // first read land on them.
    const mine = csvImport.claim();
    try {
      const levels = parseWindProfileCsv(await readFileText(file));
      if (!mine()) return;
      replaceLevels(levels);
      setError(null);
      onCommit?.();
    } catch (e) {
      if (!mine()) return;
      // Import replaces the profile, so a bad file must leave it untouched:
      // parse throws before anything is set rather than half-applying.
      setError(
        e instanceof WindProfileCsvError
          ? t(`windProfile.csv.${e.key}`, { line: e.line })
          : t('windProfile.csv.unreadable'),
      );
    }
  };
  const levelsFile = useFilePick({ accept: '.csv,text/csv', onFile: (f) => void importCsv(f) });

  return (
    <Dialog
      id="windProfile"
      title={t('windProfile.title')}
      onClose={onClose}
      // Opened from the launch panel, which can itself sit inside the Settings dialog.
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
            <div className="flex gap-1 px-1 pb-1 text-[10px] uppercase tracking-wide text-ink-faint">
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

            {!levels.length && <p className="px-1 py-3 text-xs text-ink-faint">{t('windProfile.noLevels')}</p>}

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
                      // No `?? 0`, unlike the columns beside it: an altitude is
                      // the level's identity to the kernel, not a quantity with
                      // a harmless zero, so an emptied box writes nothing
                      // rather than moving the layer down onto the pad.
                      onChange={onSi(u.plain('distance'), (si) => si !== null && patchLevel(i, { altitudeM: si }))}
                      invalid={dupeRows.has(i)}
                      // `markRing`, not another ring class appended: both are
                      // the same custom property and Tailwind emits them in its
                      // own order, so the later one in the string does not
                      // reliably win. Swapping it is what the field rows do.
                      className={markRing(`${cell} w-20`, dupeRows.has(i))}
                    />
                    <NumberInput
                      step={u.step('windspeed', 0.5)}
                      min={0}
                      max={i === surfaceLevel ? u.toUi('windspeed', MAX_WIND_SPEED_MS) : undefined}
                      ariaLabel={`${t('launch.speed')} ${i + 1}`}
                      value={u.toUi('windspeed', l.speed)}
                      onChange={onSi(u.plain('windspeed'), (si) => setSpeed(i, si ?? 0))}
                      className={`${cell} w-16`}
                    />
                    <NumberInput
                      step={u.step('angle', (5 * Math.PI) / 180)}
                      ariaLabel={`${t('launch.direction')} ${i + 1}`}
                      value={u.toUi('angle', degToRad(l.directionDeg))}
                      onChange={onSi(
                        u.plain('angle'),
                        (si) => patchLevel(i, { directionDeg: si ?? 0 }),
                        // Stored in degrees, like the `.ork`'s wind direction.
                        (si) => radToDeg(si),
                      )}
                      className={`${cell} w-14`}
                    />
                    <NumberInput
                      step={u.step('windspeed', 0.5)}
                      min={0}
                      max={u.toUi('windspeed', MAX_WIND_SPEED_MS)}
                      ariaLabel={`${t('windProfile.deviation')} ${i + 1}`}
                      value={u.toUi('windspeed', l.stddev)}
                      onChange={onSi(u.plain('windspeed'), (si) => patchLevel(i, { stddev: si ?? 0 }))}
                      className={`${cell} w-16`}
                    />
                    <NumberInput
                      step={1}
                      min={0}
                      max={MAX_TURBULENCE_PERCENT}
                      ariaLabel={`${t('windProfile.turbulence')} ${i + 1}`}
                      value={Math.round(intensity * 100)}
                      onChange={(v) => patchLevel(i, { stddev: stdDevForIntensity(l.speed, (v ?? 0) / 100) })}
                      className={`${cell} w-14`}
                    />
                    <span className="w-20 truncate text-[11px] text-ink-muted">
                      {t(`launch.turbulenceLevel.${turbulenceLevel(intensity)}`)}
                    </span>
                    <button
                      onClick={() => {
                        removeLevel(i);
                        onCommit?.();
                      }}
                      title={t('launch.removeLevel')}
                      aria-label={`${t('launch.removeLevel')} ${i + 1}`}
                      className="w-6 rounded bg-danger-500/15 py-1 text-xs text-danger-300 ring-1 ring-danger-500/30"
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
              <button className={btn} onClick={levelsFile.pick}>
                {t('windProfile.importLevels')}
              </button>
              {levelsFile.input}
            </div>
            <p className="mt-1 text-[11px] leading-snug text-ink-faint">{t('windProfile.csvFormat')}</p>
            {dupeRows.size > 0 && (
              <p role="alert" className="mt-1 text-[11px] leading-snug text-danger-300">
                {t('windProfile.duplicateAltitude')}
              </p>
            )}
            {error && (
              <p role="alert" className="mt-1 text-[11px] leading-snug text-danger-300">
                {error}
              </p>
            )}
          </div>

          <div className="min-w-0">
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
              {t('windProfile.visualization')}
            </h3>
            <div className="rounded-lg bg-canvas/40 p-2 ring-1 ring-line/5">
              <ProfileChart levels={levels} u={u} showVectors={showVectors} />
            </div>
            <Check
              className="mt-2 text-xs text-ink-muted"
              checked={showVectors}
              onChange={setShowVectors}
              label={t('windProfile.showVectors')}
            />

            <fieldset className="mt-4">
              <legend className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
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
                      className="accent-accent-500"
                    />
                    <span className="text-xs text-ink-muted">{t(`windProfile.${r}`)}</span>
                  </label>
                ))}
              </div>
              <p className="mt-1 text-[11px] leading-snug text-ink-faint">{t('windProfile.referenceNote')}</p>
            </fieldset>
          </div>
        </div>

        <div className="mt-5 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-lg bg-accent-600 px-3 py-1.5 text-sm font-medium text-on-accent hover:bg-accent-500"
          >
            {t('common.close')}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
