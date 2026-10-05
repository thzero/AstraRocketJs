import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUnits } from '../../prefs/useUnits';
import { airDensity } from '../../services/flight/recoverySizing';
import { LAUNCH_SITE_LIMITS } from '../../services/storage/launchLocationStore';
import { Num, QNum } from '../sim/LaunchPanel';
import { SizingFigures } from './SizingFigures';
import { ToolGroup } from './ToolGroup';

/**
 * Parachute sizing with no design: a descent mass, a canopy's Cd and the site's
 * air give the canopy for the main and drogue bands, or for a rate of your own.
 * The same figures the parachute editor's sizing dialog shows, from typed inputs.
 */

interface Remembered {
  massKg: number | null;
  cd: number | null;
  diameterM: number | null;
  siteM: number | null;
  temperatureC: number | null;
}
let remembered: Remembered | null = null;

/** Clears the remembered inputs, so each test starts from the defaults. */
export function forgetParachuteTool(): void {
  remembered = null;
}

export function ParachuteTool() {
  const { t } = useTranslation();
  const u = useUnits();
  const [massKg, setMassKg] = useState<number | null>(() => (remembered ? remembered.massKg : 0.5));
  const [cd, setCd] = useState<number | null>(() => (remembered ? remembered.cd : 0.8));
  const [diameterM, setDiameterM] = useState<number | null>(() => (remembered ? remembered.diameterM : null));
  const [siteM, setSiteM] = useState<number | null>(() => (remembered ? remembered.siteM : 0));
  const [temperatureC, setTemperatureC] = useState<number | null>(() => (remembered ? remembered.temperatureC : null));
  useEffect(() => {
    remembered = { massKg, cd, diameterM, siteM, temperatureC };
  }, [massKg, cd, diameterM, siteM, temperatureC]);

  const rho = airDensity({ launchAltitudeM: siteM, temperatureC });
  const ready = massKg != null && massKg > 0 && cd != null && cd > 0;

  return (
    <div className="grid gap-4 lg:grid-cols-[22rem_minmax(0,28rem)]">
      <div className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-200">{t('chuteTool.title')}</h2>
          <p className="mt-1 text-xs text-slate-400">{t('chuteTool.intro')}</p>
        </div>
        <ToolGroup title={t('chuteTool.rocket')}>
          <QNum
            label={t('chuteTool.mass')}
            hint={t('chuteTool.massHint')}
            field="chuteMass"
            kind="mass"
            u={u}
            stepSi={0.01}
            minSi={0.001}
            maxSi={1000}
            required
            missing={massKg == null}
            value={massKg}
            onChange={setMassKg}
          />
          <Num
            label={t('chuteTool.cd')}
            step={0.05}
            min={0.05}
            max={3}
            required
            missing={cd == null}
            value={cd}
            onChange={setCd}
          />
          <QNum
            label={t('chuteTool.diameter')}
            field="chuteDiameter"
            kind="length"
            u={u}
            stepSi={0.01}
            minSi={0.01}
            maxSi={20}
            placeholder={t('chuteTool.none')}
            value={diameterM}
            onChange={setDiameterM}
          />
        </ToolGroup>
        <ToolGroup title={t('chuteTool.air')}>
          <QNum
            label={t('landing.siteElevation')}
            field="chuteSiteElevation"
            kind="distance"
            u={u}
            stepSi={10}
            minSi={LAUNCH_SITE_LIMITS.launchAltitudeM.min}
            maxSi={LAUNCH_SITE_LIMITS.launchAltitudeM.max}
            value={siteM}
            onChange={setSiteM}
          />
          <QNum
            label={t('launch.temperature')}
            field="chuteTemperature"
            kind="degC"
            u={u}
            stepSi={1}
            minSi={-90 + 273.15}
            maxSi={70 + 273.15}
            placeholder={t('chuteTool.standard')}
            value={temperatureC}
            onChange={setTemperatureC}
          />
        </ToolGroup>
      </div>
      <section className="h-fit rounded-xl bg-slate-900 p-3 ring-1 ring-white/10" aria-label={t('chuteTool.result')}>
        {ready ? (
          <SizingFigures massKg={massKg} cd={cd} rho={rho} diameterM={diameterM} />
        ) : (
          <p className="text-xs text-slate-400">{t('chuteTool.empty')}</p>
        )}
      </section>
    </div>
  );
}
