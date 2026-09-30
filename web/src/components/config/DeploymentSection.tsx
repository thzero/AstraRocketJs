import { useTranslation } from 'react-i18next';
import type { ComponentNode } from '../../engine/openRocketEngine';
import { deployOverride, type FlightConfig } from '../../services/flight/flightConfigs';
import { useWorkspaceStore } from '../../state/store';
import { NumberInput } from '../common/NumberInput';
import { useUnits } from '../../prefs/useUnits';
import { onSi } from '../../prefs/entryValue';
import { unitScope } from '../../prefs/units';
import { num, str } from '../../tree/nodeProps';

/** The kernel's DeployEvent vocabulary, in the order the property panel offers it. */
const DEPLOY_EVENTS = ['apogee', 'ejection', 'altitude', 'launch', 'never'] as const;

/**
 * When one recovery device opens under THIS configuration.
 *
 * Every field is an override with a fall-through: empty means the device's own
 * value on the design, which is shown as the placeholder, so the control reads
 * as the value the flight will actually use. That is the same shape a
 * simulation's preference overrides have, and it is what makes "deploy the main
 * at 150 m on this flight only" one field rather than a second copy of the part.
 */
export function DeploymentSection({ config, device }: { config: FlightConfig; device: ComponentNode }) {
  const { t } = useTranslation();
  const u = useUnits();
  const setDeployment = useWorkspaceStore((s) => s.setDeployment);
  const onCommit = useWorkspaceStore((s) => s.commitEdit);

  const id = device.id as string;
  const over = deployOverride(config, id);
  // What the design says, which is what an un-overridden field falls through to.
  const baseEvent = str(device, 'deployEvent') || 'apogee';
  const event = over?.deployEvent ?? baseEvent;
  const scope = unitScope('prop', device.type, 'deployAltitude');
  const alt = u.at(scope, 'distance');

  const name = str(device, 'name') || t(`part.${device.type}`);
  return (
    <section aria-label={name} className="rounded-xl bg-slate-900 p-3 ring-1 ring-white/10">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="truncate text-sm font-medium text-slate-200">{name}</span>
        {over && (
          <span className="shrink-0 text-[10px] uppercase tracking-wide text-amber-300">{t('configs.overridden')}</span>
        )}
      </div>

      <label className="flex items-center justify-between gap-3">
        <span className="text-xs text-slate-400">{t('prop.deployEvent')}</span>
        <select
          value={over?.deployEvent ?? ''}
          aria-label={`${name} — ${t('prop.deployEvent')}`}
          onChange={(e) => {
            setDeployment(config.id, id, 'deployEvent', e.target.value || null);
            onCommit();
          }}
          className="w-40 rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-100 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500"
        >
          {/* "As designed" is the first option, not a blank: the reader has to be
              able to tell "follows the design" from a value somebody chose. */}
          <option value="">{t('configs.asDesigned', { value: t(`deployEvent.${baseEvent}`) })}</option>
          {DEPLOY_EVENTS.map((ev) => (
            <option key={ev} value={ev}>
              {t(`deployEvent.${ev}`)}
            </option>
          ))}
        </select>
      </label>

      {/* Altitude is only read by the altitude trigger, and the property panel
          shows it unconditionally for the same reason: the value survives a trip
          through another event and is there when you come back. */}
      <label className="mt-2 flex items-center justify-between gap-3">
        <span className="text-xs text-slate-400">{t('prop.deployAltitude')}</span>
        <span className="flex items-center gap-1">
          <NumberInput
            ariaLabel={`${name} — ${t('prop.deployAltitude')}`}
            value={over?.deployAltitude == null ? null : alt.toUi(over.deployAltitude)}
            placeholder={alt.fmt(num(device, 'deployAltitude'))}
            step={alt.step(10)}
            onChange={onSi(alt, (si) => setDeployment(config.id, id, 'deployAltitude', si))}
            onCommit={onCommit}
            className="w-24 rounded-md bg-slate-800 px-2 py-1 text-right text-sm text-slate-100 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500"
          />
          <span className="min-w-6 text-xs text-slate-500">{alt.sym}</span>
        </span>
      </label>

      <label className="mt-2 flex items-center justify-between gap-3">
        <span className="text-xs text-slate-400">{t('prop.deployDelay')}</span>
        <span className="flex items-center gap-1">
          <NumberInput
            ariaLabel={`${name} — ${t('prop.deployDelay')}`}
            value={over?.deployDelay ?? null}
            placeholder={String(num(device, 'deployDelay'))}
            step={0.5}
            min={0}
            onChange={(v) => setDeployment(config.id, id, 'deployDelay', v)}
            onCommit={onCommit}
            className="w-24 rounded-md bg-slate-800 px-2 py-1 text-right text-sm text-slate-100 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500"
          />
          <span className="min-w-6 text-xs text-slate-500">s</span>
        </span>
      </label>

      {event === 'altitude' && over?.deployAltitude == null && (
        <p className="mt-2 text-[11px] leading-snug text-slate-500">{t('configs.altitudeFromDesign')}</p>
      )}
    </section>
  );
}
