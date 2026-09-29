import { useTranslation } from 'react-i18next';
import type { ComponentNode } from '../../engine/openRocketEngine';
import { sepOverride, stageFlies, type FlightConfig } from '../../services/flightConfigs';
import { useWorkspaceStore } from '../../state/store';
import { NumberInput } from '../common/NumberInput';
import { useUnits } from '../../prefs/useUnits';
import { unitScope } from '../../prefs/units';
import { num, str } from '../../tree/nodeProps';

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
 * Whether one stage flies under THIS configuration, and when it lets go.
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
  const baseEvent = str(stage, 'separationEvent') || 'ejection';
  const event = over?.separationEvent ?? baseEvent;
  const alt = u.at(unitScope('prop', stage.type, 'separationAltitude'), 'distance');
  const name = str(stage, 'name') || t(`part.${stage.type}`);

  return (
    <section aria-label={name} className="rounded-xl bg-slate-900 p-3 ring-1 ring-white/10">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="truncate text-sm font-medium text-slate-200">{name}</span>
        {over && (
          <span className="shrink-0 text-[10px] uppercase tracking-wide text-amber-300">{t('configs.overridden')}</span>
        )}
      </div>

      {/* Whether it flies at all comes FIRST: everything under it describes a
          stage that is in the flight, and a grounded stage separates from
          nothing. */}
      <label className="flex items-center justify-between gap-3">
        <span className="text-xs text-slate-400">{t('configs.flies')}</span>
        <input
          type="checkbox"
          checked={flies}
          aria-label={`${name} - ${t('configs.flies')}`}
          onChange={(e) => setStageFlies(config.id, id, e.target.checked)}
          className="accent-sky-500"
        />
      </label>

      {!flies && <p className="mt-2 text-[11px] leading-snug text-slate-500">{t('configs.groundedHint')}</p>}

      {flies && separates && (
        <>
          <label className="mt-2 flex items-center justify-between gap-3">
            <span className="text-xs text-slate-400">{t('prop.separationEvent')}</span>
            <select
              value={over?.separationEvent ?? ''}
              aria-label={`${name} - ${t('prop.separationEvent')}`}
              onChange={(e) => {
                setSeparation(config.id, id, 'separationEvent', e.target.value || null);
                onCommit();
              }}
              className="w-44 rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-100 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500"
            >
              <option value="">{t('configs.asDesigned', { value: t(`separationEvent.${baseEvent}`) })}</option>
              {SEPARATION_EVENTS.map((ev) => (
                <option key={ev} value={ev}>
                  {t(`separationEvent.${ev}`)}
                </option>
              ))}
            </select>
          </label>

          <label className="mt-2 flex items-center justify-between gap-3">
            <span className="text-xs text-slate-400">{t('prop.separationDelay')}</span>
            <span className="flex items-center gap-1">
              <NumberInput
                ariaLabel={`${name} - ${t('prop.separationDelay')}`}
                value={over?.separationDelay ?? null}
                placeholder={String(num(stage, 'separationDelay'))}
                step={0.5}
                min={0}
                onChange={(v) => setSeparation(config.id, id, 'separationDelay', v)}
                onCommit={onCommit}
                className="w-24 rounded-md bg-slate-800 px-2 py-1 text-right text-sm text-slate-100 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500"
              />
              <span className="min-w-6 text-xs text-slate-500">s</span>
            </span>
          </label>

          {/* The altitude is read by the two altitude triggers only, and is offered
          for the same reason the property panel offers it: the value survives a
          trip through another event and is there when you come back. */}
          <label className="mt-2 flex items-center justify-between gap-3">
            <span className="text-xs text-slate-400">{t('prop.separationAltitude')}</span>
            <span className="flex items-center gap-1">
              <NumberInput
                ariaLabel={`${name} - ${t('prop.separationAltitude')}`}
                value={over?.separationAltitude == null ? null : alt.toUi(over.separationAltitude)}
                placeholder={alt.fmt(num(stage, 'separationAltitude', 200))}
                step={alt.step(10)}
                onChange={(v) => setSeparation(config.id, id, 'separationAltitude', v == null ? null : alt.fromUi(v))}
                onCommit={onCommit}
                className="w-24 rounded-md bg-slate-800 px-2 py-1 text-right text-sm text-slate-100 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500"
              />
              <span className="min-w-6 text-xs text-slate-500">{alt.sym}</span>
            </span>
          </label>

          {event === 'never' && (
            <p className="mt-2 text-[11px] leading-snug text-slate-500">{t('configs.neverSeparates')}</p>
          )}
        </>
      )}
    </section>
  );
}
