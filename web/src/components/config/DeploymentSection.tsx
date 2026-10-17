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
import { LOWER_STAGE_SEPARATION, hasStageBelow } from '../../services/design/fieldRange';
import { findNode } from '../../services/design/treeEdit';

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
  // Whether the device's stage has one below it; undefined for a device the
  // design does not hold, which is offered every event.
  const stageBelow = useWorkspaceStore((s) => (findNode(s.tree, id) ? hasStageBelow(s.tree, id) : undefined));
  const over = deployOverride(config, id);
  // What the design says, which is what an un-overridden field falls through to.
  const design = designDeployment(device);
  const baseEvent = design.deployEvent;
  const event = over?.deployEvent ?? baseEvent;
  // The lower-stage separation never fires on the bottom stage (the design field
  // drops it there too, fieldRange.fieldOptions); a value the flight already
  // holds stays on offer so an imported file shows as itself.
  const events = DEPLOY_EVENTS.filter(
    (ev) => ev !== LOWER_STAGE_SEPARATION || stageBelow !== false || event === LOWER_STAGE_SEPARATION,
  );
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
        options={events.map((ev) => ({ value: ev, label: t(`deployEvent.${ev}`) }))}
        onChange={(v) => {
          setDeployment(config.id, id, 'deployEvent', v);
          onCommit();
        }}
      />

      {/* Altitude is read by the altitude trigger only, so the box is offered
          under that event alone, as the property panel and desktop do; a stored
          override survives a trip through another event and is back with it. */}
      {event === 'altitude' && (
        <OverrideNumber
          name={name}
          label={t('prop.deployAltitude')}
          value={over?.deployAltitude == null ? null : alt.toUi(over.deployAltitude)}
          placeholder={alt.fmt(design.deployAltitude)}
          step={alt.step(10)}
          // Floored at zero, as the design-side box is by `fieldRange`. `onSi`
          // does not reject a negative, and a negative deploy altitude never
          // fires the kernel's altitude trigger, so the design would fly
          // ballistic under this configuration.
          min={alt.toUi(0)}
          unit={alt.sym}
          onChange={onSi(alt, (si) => setDeployment(config.id, id, 'deployAltitude', si))}
          onCommit={onCommit}
        />
      )}

      <OverrideNumber
        name={name}
        label={t('prop.deployDelay')}
        value={over?.deployDelay ?? null}
        placeholder={fmtUpTo(design.deployDelay, 2)}
        step={0.5}
        min={0}
        unit={t('units.second')}
        onChange={(v) => setDeployment(config.id, id, 'deployDelay', v)}
        onCommit={onCommit}
      />

      {event === 'altitude' && over?.deployAltitude == null && (
        <p className="mt-2 text-[11px] leading-snug text-ink-faint">{t('configs.altitudeFromDesign')}</p>
      )}
    </OverrideCard>
  );
}
