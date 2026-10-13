import { useTranslation } from 'react-i18next';
import type { ComponentNode } from '../../engine/openRocketEngine';
import { deployOverride, designDeployment, type FlightConfig } from '../../services/flight/flightConfigs';
import { useWorkspaceStore } from '../../state/store';
import { OverrideCard, OverrideNumber, OverrideSelect } from './OverrideFields';
import { useUnits } from '../../prefs/useUnits';
import { onSi } from '../../prefs/entryValue';
import { unitScope } from '../../prefs/units';
import { fmtUpTo } from '../../i18n/format';
import { partName } from './ConfigsTable';
// The design field's list, so the override offers every event the part can.
import { DEPLOY_EVENTS } from '../../services/design/componentFields';

/**
 * When one recovery device opens under this configuration.
 *
 * Every field is an override with a fall-through: empty means the device's own
 * value on the design, which is shown as the placeholder, so the control reads
 * as the value the flight will actually use. That is the same shape a
 * simulation's preference overrides have, and it is what makes "deploy the main
 * at 150 m on this flight only" one field rather than a second copy of the part.
 */
export function DeploymentSection({
  config,
  device,
  index,
}: {
  config: FlightConfig;
  device: ComponentNode;
  /** The device's place among the design's recovery devices, for an unnamed one's label. */
  index: number;
}) {
  const { t } = useTranslation();
  const u = useUnits();
  const setDeployment = useWorkspaceStore((s) => s.setDeployment);
  const onCommit = useWorkspaceStore((s) => s.commitEdit);

  const id = device.id as string;
  const over = deployOverride(config, id);
  // What the design says, which is what an un-overridden field falls through to.
  const design = designDeployment(device);
  const baseEvent = design.deployEvent;
  const event = over?.deployEvent ?? baseEvent;
  const scope = unitScope('prop', device.type, 'deployAltitude');
  const alt = u.at(scope, 'distance');

  const name = partName(device, index, t);
  return (
    <OverrideCard name={name} overridden={!!over}>
      <OverrideSelect
        first
        name={name}
        label={t('prop.deployEvent')}
        value={over?.deployEvent}
        designed={t(`deployEvent.${baseEvent}`)}
        options={DEPLOY_EVENTS.map((ev) => ({ value: ev, label: t(`deployEvent.${ev}`) }))}
        onChange={(v) => {
          setDeployment(config.id, id, 'deployEvent', v);
          onCommit();
        }}
      />

      {/* Altitude is only read by the altitude trigger, and the property panel
          shows it unconditionally for the same reason: the value survives a trip
          through another event and is there when you come back. */}
      <OverrideNumber
        name={name}
        label={t('prop.deployAltitude')}
        value={over?.deployAltitude == null ? null : alt.toUi(over.deployAltitude)}
        placeholder={alt.fmt(design.deployAltitude)}
        step={alt.step(10)}
        // Floored at zero, as the design-side field is by `NumberField`'s own
        // `min = 0` default. `onSi` rejects only a null or a failed conversion,
        // not a negative, so a typed or pasted -150 would commit into the flight
        // configuration: the kernel's altitude trigger then never fires and the
        // design flies ballistic under that one configuration, with nothing on
        // screen marking the field.
        min={alt.toUi(0)}
        unit={alt.sym}
        onChange={onSi(alt, (si) => setDeployment(config.id, id, 'deployAltitude', si))}
        onCommit={onCommit}
      />

      <OverrideNumber
        name={name}
        label={t('prop.deployDelay')}
        value={over?.deployDelay ?? null}
        placeholder={fmtUpTo(design.deployDelay, 2)}
        step={0.5}
        min={0}
        unit="s"
        onChange={(v) => setDeployment(config.id, id, 'deployDelay', v)}
        onCommit={onCommit}
      />

      {event === 'altitude' && over?.deployAltitude == null && (
        <p className="mt-2 text-[11px] leading-snug text-ink-faint">{t('configs.altitudeFromDesign')}</p>
      )}
    </OverrideCard>
  );
}
