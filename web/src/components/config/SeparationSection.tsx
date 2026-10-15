import { useTranslation } from 'react-i18next';
import type { ComponentNode } from '../../engine/openRocketEngine';
import { designSeparation, type FlightConfig, sepOverride, stageFlies } from '../../services/flight/flightConfigs';
import { useWorkspaceStore } from '../../state/store';
import { findStages } from '../../services/design/treeEdit';
import { OverrideCard, overrideFieldLabel, OverrideNumber, OverrideRow, OverrideSelect } from './OverrideFields';
import { useUnits } from '../../prefs/useUnits';
import { onSi } from '../../prefs/entryValue';
import { unitScope } from '../../prefs/units';
import { fmtUpTo } from '../../i18n/format';
import { partName } from './ConfigsTable';
import { SEPARATION_EVENTS } from '../../services/design/componentFields';

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
  index,
  separates,
}: {
  config: FlightConfig;
  stage: ComponentNode;
  /** The stage's place in the design, for an unnamed one's label. */
  index: number;
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
  // Something has to fly, so the only stage still flying cannot be grounded.
  const onlyFlying = useWorkspaceStore(
    (s) => flies && findStages(s.tree).every((n) => n.id === id || !stageFlies(config, n.id as string)),
  );
  const over = sepOverride(config, id);
  const design = designSeparation(stage);
  const baseEvent = design.separationEvent;
  const event = over?.separationEvent ?? baseEvent;
  const alt = u.at(unitScope('prop', stage.type, 'separationAltitude'), 'distance');
  const name = partName(stage, index, t);

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
          disabled={onlyFlying}
          title={onlyFlying ? t('configs.lastFlyingStage') : undefined}
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
            placeholder={fmtUpTo(design.separationDelay, 2)}
            step={0.5}
            min={0}
            unit={t('units.second')}
            onChange={(v) => setSeparation(config.id, id, 'separationDelay', v)}
            onCommit={onCommit}
          />

          {/* The altitude is read by the two altitude triggers only, so the box is
              offered under those alone, as the property panel and desktop do; a
              stored override survives a trip through another event. */}
          {event.startsWith('altitude') && (
            <OverrideNumber
              name={name}
              label={t('prop.separationAltitude')}
              value={over?.separationAltitude == null ? null : alt.toUi(over.separationAltitude)}
              placeholder={alt.fmt(design.separationAltitude)}
              step={alt.step(10)}
              // Floored at zero, as the design-side box is by `fieldRange` (a
              // `distance` field is non-negative). `onSi` rejects only a
              // null or a failed conversion, not a negative, so a typed -150 would
              // commit and the stage would never separate on altitude under that
              // one configuration.
              min={alt.toUi(0)}
              unit={alt.sym}
              onChange={onSi(alt, (si) => setSeparation(config.id, id, 'separationAltitude', si))}
              onCommit={onCommit}
            />
          )}

          {event === 'never' && (
            <p className="mt-2 text-[11px] leading-snug text-ink-faint">{t('configs.neverSeparates')}</p>
          )}
        </>
      )}
    </OverrideCard>
  );
}
