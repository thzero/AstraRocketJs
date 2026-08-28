import { useTranslation } from 'react-i18next';
import type { LaunchConditions, WindLevel } from '../../services/orkTree';

/**
 * Launch & atmosphere conditions for the flight simulation: wind (single average
 * or an altitude-layered multilevel profile), launch rod, launch site, base
 * atmosphere, and the Earth (geodetic) model. Emits a shallow patch on change;
 * App feeds these straight into simulate(). Populated from an imported .ork.
 */

function Num({ label, unit, value, step = 1, min, placeholder, onChange }: {
  label: string; unit?: string; value: number | null; step?: number; min?: number; placeholder?: string;
  onChange: (v: number | null) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-xs text-slate-400">{label}</span>
      <span className="flex items-center gap-1">
        <input
          type="number" step={step} min={min} placeholder={placeholder}
          value={value === null || value === undefined || Number.isNaN(value) ? '' : +(+value).toFixed(4)}
          onChange={(e) => onChange(e.target.value === '' ? null : (parseFloat(e.target.value) || 0))}
          className="w-24 rounded-md bg-slate-800 px-2 py-1 text-right text-sm text-slate-100 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500"
        />
        {unit && <span className="w-8 text-xs text-slate-500">{unit}</span>}
      </span>
    </label>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl bg-slate-900 p-3 ring-1 ring-white/10">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</h3>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

export function LaunchPanel({ launch, onChange }: {
  launch: LaunchConditions; onChange: (patch: Partial<LaunchConditions>) => void;
}) {
  const { t } = useTranslation();
  const levels = launch.windLevels ?? [];
  const multilevel = levels.length > 0;

  const setLevels = (next: WindLevel[]) => onChange({ windLevels: next.length ? next : undefined });
  const patchLevel = (i: number, p: Partial<WindLevel>) =>
    setLevels(levels.map((l, j) => (j === i ? { ...l, ...p } : l)));

  const toggleMultilevel = (on: boolean) => {
    if (on) {
      onChange({ windLevels: [{ altitudeM: 0, speed: launch.windAverage || 0, directionDeg: launch.windDirectionDeg ?? 90, stddev: launch.windStdDev || 0 }] });
    } else {
      onChange({ windLevels: undefined });
    }
  };

  return (
    <div className="space-y-3 p-3">
      <Group title={t('launch.launchRod')}>
        <Num label={t('launch.length')} unit="m" step={0.1} min={0} value={launch.launchRodLengthM} onChange={(v) => onChange({ launchRodLengthM: v ?? 0 })} />
        <Num label={t('launch.angle')} unit="°" step={1} value={launch.launchRodAngleDeg} onChange={(v) => onChange({ launchRodAngleDeg: v ?? 0 })} />
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={launch.launchIntoWind ?? false} onChange={(e) => onChange({ launchIntoWind: e.target.checked })} className="accent-sky-500" />
          <span className="text-xs text-slate-400">{t('launch.intoWind')}</span>
        </label>
        {!launch.launchIntoWind && (
          <Num label={t('launch.rodDirection')} unit="°" step={5} value={launch.launchRodDirectionDeg ?? 90} onChange={(v) => onChange({ launchRodDirectionDeg: v ?? 0 })} />
        )}
      </Group>

      <Group title={t('launch.site')}>
        <Num label={t('launch.altitude')} unit="m" step={10} value={launch.launchAltitudeM} onChange={(v) => onChange({ launchAltitudeM: v ?? 0 })} />
        <Num label={t('launch.latitude')} unit="°" step={1} value={launch.latitudeDeg} onChange={(v) => onChange({ latitudeDeg: v ?? 0 })} />
        <Num label={t('launch.longitude')} unit="°" step={1} value={launch.longitudeDeg ?? null} onChange={(v) => onChange({ longitudeDeg: v ?? undefined })} />
        {'geolocation' in navigator && (
          <button
            onClick={() => navigator.geolocation.getCurrentPosition(
              (pos) => onChange({ latitudeDeg: +pos.coords.latitude.toFixed(4), longitudeDeg: +pos.coords.longitude.toFixed(4) }),
              () => { /* denied or unavailable — leave the fields as they are */ },
              { timeout: 10000 },
            )}
            className="w-full rounded-md bg-slate-800 px-2 py-1.5 text-xs font-medium text-slate-300 ring-1 ring-white/10 hover:bg-slate-700"
          >📍 {t('launch.useLocation')}</button>
        )}
      </Group>

      <Group title={t('launch.atmosphere')}>
        <Num label={t('launch.temperature')} unit="°C" step={1} placeholder={t('launch.isa')} value={launch.temperatureC} onChange={(v) => onChange({ temperatureC: v })} />
        <Num label={t('launch.pressure')} unit="hPa" step={1} placeholder={t('launch.isa')} value={launch.pressureHPa} onChange={(v) => onChange({ pressureHPa: v })} />
      </Group>

      <Group title={t('launch.wind')}>
        <label className="flex items-center justify-between gap-3 pb-1">
          <span className="text-xs text-slate-400">{t('launch.variesWithAltitude')}</span>
          <input type="checkbox" checked={multilevel} onChange={(e) => toggleMultilevel(e.target.checked)} className="accent-sky-500" />
        </label>

        {!multilevel ? (
          <>
            <Num label={t('launch.speed')} unit="m/s" step={0.5} min={0} value={launch.windAverage} onChange={(v) => onChange({ windAverage: v ?? 0 })} />
            <Num label={t('launch.direction')} unit="°" step={5} value={launch.windDirectionDeg ?? 90} onChange={(v) => onChange({ windDirectionDeg: v ?? 0 })} />
            <Num label={t('launch.gusts')} unit="m/s" step={0.5} min={0} value={launch.windStdDev} onChange={(v) => onChange({ windStdDev: v ?? 0 })} />
          </>
        ) : (
          <div className="space-y-2">
            <div className="flex gap-1 px-1 text-[10px] uppercase tracking-wide text-slate-500">
              <span className="w-16">Alt m</span><span className="w-14">m/s</span><span className="w-12">dir°</span><span className="w-12">gust</span><span className="w-6" />
            </div>
            {levels.map((l, i) => (
              <div key={i} className="flex items-center gap-1">
                <input type="number" step={50} value={+l.altitudeM.toFixed(2)} onChange={(e) => patchLevel(i, { altitudeM: parseFloat(e.target.value) || 0 })} className="w-16 rounded bg-slate-800 px-1 py-1 text-right text-xs text-slate-100 ring-1 ring-white/10" />
                <input type="number" step={0.5} value={+l.speed.toFixed(2)} onChange={(e) => patchLevel(i, { speed: parseFloat(e.target.value) || 0 })} className="w-14 rounded bg-slate-800 px-1 py-1 text-right text-xs text-slate-100 ring-1 ring-white/10" />
                <input type="number" step={5} value={+l.directionDeg.toFixed(1)} onChange={(e) => patchLevel(i, { directionDeg: parseFloat(e.target.value) || 0 })} className="w-12 rounded bg-slate-800 px-1 py-1 text-right text-xs text-slate-100 ring-1 ring-white/10" />
                <input type="number" step={0.5} value={+l.stddev.toFixed(2)} onChange={(e) => patchLevel(i, { stddev: parseFloat(e.target.value) || 0 })} className="w-12 rounded bg-slate-800 px-1 py-1 text-right text-xs text-slate-100 ring-1 ring-white/10" />
                <button onClick={() => setLevels(levels.filter((_, j) => j !== i))} title={t('launch.removeLevel')} className="w-6 rounded bg-red-500/15 py-1 text-xs text-red-300 ring-1 ring-red-500/30">×</button>
              </div>
            ))}
            <button
              onClick={() => setLevels([...levels, { altitudeM: (levels[levels.length - 1]?.altitudeM ?? 0) + 300, speed: levels[levels.length - 1]?.speed ?? 0, directionDeg: levels[levels.length - 1]?.directionDeg ?? 90, stddev: levels[levels.length - 1]?.stddev ?? 0 }])}
              className="w-full rounded-md bg-slate-800 py-1 text-xs font-medium text-sky-300 ring-1 ring-white/10 hover:bg-slate-700"
            >{t('launch.addLevel')}</button>
          </div>
        )}
      </Group>

      <Group title={t('launch.earthModel')}>
        <label className="flex items-center justify-between gap-3">
          <span className="text-xs text-slate-400">{t('launch.geodetic')}</span>
          <select
            value={launch.geodetic ?? 'spherical'}
            onChange={(e) => onChange({ geodetic: e.target.value as LaunchConditions['geodetic'] })}
            className="w-32 rounded-md bg-slate-800 px-2 py-1 text-sm text-slate-100 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500"
          >
            <option value="flat">{t('launch.flat')}</option>
            <option value="spherical">{t('launch.spherical')}</option>
            <option value="wgs84">{t('launch.wgs84')}</option>
          </select>
        </label>
      </Group>
    </div>
  );
}
