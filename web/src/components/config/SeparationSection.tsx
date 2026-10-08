import { useTranslation } from 'react-i18next';
import type { ComponentNode } from '../../engine/openRocketEngine';
import { designSeparation, type FlightConfig, sepOverride, stageFlies } from '../../services/flight/flightConfigs';
import { useWorkspaceStore } from '../../state/store';
import { OverrideCard, overrideFieldLabel, OverrideNumber, OverrideRow, OverrideSelect } from './OverrideFields';
import { useUnits } from '../../prefs/useUnits';
import { onSi } from '../../prefs/entryValue';
import { unitScope } from '../../prefs/units';
import { partLabel } from '../../i18n/format';

/**
 * The kernel's SeparationEvent vocabulary, in the order the property panel
 * offers it (ejection first: the desktop default and the low-power norm).
 */
const SEPARATION_EVENTS = [
  'ejection',
  'burnout',
  'launch',
  'ignition',
  'upperignition',
  'apogee',
  'altitudeascending',
  'altitudedescending',
  'never',
] as const;

/**
 * Whether one stage flies under this configuration, and when it lets go.
 *
 * The same override shape the recovery section has: empty follows the design,
 * whose value is the placeholder, so the control reads as what the flight will
 * use. Staging is the other half of what a flight configuration decides, and a
 * two-stage rocket flown on a long burn and on a short one usually wants two
 * separation delays, not two designs.
 */
export function SeparationSection({
  config,
  stage,
  separates,
}: {
  config: FlightConfig;
  stage: ComponentNode;
  /** False for the top stage, which has nothing above it to let go of. */
  separates: boolean;
}) {
  const { t } = useTranslation();
  const u = useUnits();
  const setSeparation = useWorkspaceStore((s) => s.setSeparation);
  const setStageFlies = useWorkspaceStore((s) => s.setStageFlies);
  const onCommit = useWorkspaceStore((s) => s.commitEdit);

  const id = stage.id as string;
  const flies = stageFlies(config, id);
  const over = sepOverride(config, id);
  const design = designSeparation(stage);
  const baseEvent = design.separationEvent;
  const event = over?.separationEvent ?? baseEvent;
  const alt = u.at(unitScope('prop', stage.type, 'separationAltitude'), 'distance');
  const name = partLabel(t, stage);

  return (
    <OverrideCard name={name} overridden={!!over}>
      {/* Whether it flies at all comes first: everything under it describes a
          stage that is in the flight, and a grounded stage separates from
          nothing. */}
      <OverrideRow first label={t('configs.flies')}>
        <input
          type="checkbox"
          checked={flies}
          aria-label={overrideFieldLabel(name, t('configs.flies'))}
          onChange={(e) => setStageFlies(config.id, id, e.target.checked)}
          className="accent-accent-500"
        />
      </OverrideRow>

      {!flies && <p className="mt-2 text-[11px] leading-snug text-ink-faint">{t('configs.groundedHint')}</p>}

      {flies && separates && (
        <>
          <OverrideSelect
            name={name}
            label={t('prop.separationEvent')}
            value={over?.separationEvent}
            designed={t(`separationEvent.${baseEvent}`)}
            options={SEPARATION_EVENTS.map((ev) => ({ value: ev, label: t(`separationEvent.${ev}`) }))}
            onChange={(v) => {
              setSeparation(config.id, id, 'separationEvent', v);
              onCommit();
            }}
            width="w-44"
          />

          <OverrideNumber
            name={name}
            label={t('prop.separationDelay')}
            value={over?.separationDelay ?? null}
            placeholder={String(design.separationDelay)}
            step={0.5}
            min={0}
            unit="s"
            onChange={(v) => setSeparation(config.id, id, 'separationDelay', v)}
            onCommit={onCommit}
          />

          {/* The altitude is read by the two altitude triggers only, and is offered
              for the same reason the property panel offers it: the value survives a
              trip through another event and is there when you come back. */}
          <OverrideNumber
            name={name}
            label={t('prop.separationAltitude')}
            value={over?.separationAltitude == null ? null : alt.toUi(over.separationAltitude)}
            placeholder={alt.fmt(design.separationAltitude)}
            step={alt.step(10)}
            // Floored at zero, like the design-side field. `onSi` rejects only a
            // null or a failed conversion, not a negative, so a typed -150 would
            // commit and the stage would never separate on altitude under that
            // one configuration.
            min={alt.toUi(0)}
            unit={alt.sym}
            onChange={onSi(alt, (si) => setSeparation(config.id, id, 'separationAltitude', si))}
            onCommit={onCommit}
          />

          {event === 'never' && (
            <p className="mt-2 text-[11px] leading-snug text-ink-faint">{t('configs.neverSeparates')}</p>
          )}
        </>
      )}
    </OverrideCard>
  );
}
