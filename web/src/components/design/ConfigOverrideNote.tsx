import { useTranslation } from 'react-i18next';
import type { ComponentNode } from '../../engine/openRocketEngine';
import {
  deployOverride,
  loadoutLabel,
  sepOverride,
  stageFlies,
  type FlightConfig,
} from '../../services/flight/flightConfigs';
import { useWorkspaceStore } from '../../state/store';
import type { ConfigsTab } from '../../state/tabs';

/**
 * Says when a flight configuration flies THIS part differently from the fields
 * above it.
 *
 * The deployment fields on a recovery device, and the separation fields on a
 * booster, are the design's default; a configuration may override either, and
 * may leave a whole stage on the ground. Without this line the panel would show
 * an altitude or a delay the flight never used, or a stage some flights do not
 * carry, with nothing on screen to say so: the one hazard of a value that lives
 * in two places.
 *
 * Every configuration is named, not just the one the active simulation flies,
 * because the panel belongs to the DESIGN and the question it answers is "does
 * anything fly this part differently". Each name opens the tab on it.
 */
export function ConfigOverrideNote({ node }: { node: ComponentNode }) {
  const { t } = useTranslation();
  const configs = useWorkspaceStore((s) => s.configs);

  const id = node.id as string;
  const recovery = node.type === 'parachute' || node.type === 'streamer';
  const sub: ConfigsTab = recovery ? 'recovery' : 'separation';
  const overriding = configs.filter((c) => (recovery ? deployOverride(c, id) : sepOverride(c, id)));
  const grounding = recovery ? [] : configs.filter((c) => !stageFlies(c, id));

  return (
    <>
      <NamedConfigs
        label={t(recovery ? 'configs.deployOverridden' : 'configs.separationOverridden')}
        configs={overriding}
        sub={sub}
      />
      <NamedConfigs label={t('configs.stageGrounded')} configs={grounding} sub="separation" />
    </>
  );
}

/** One line: what happens differently, and in which configurations. */
function NamedConfigs({ label, configs, sub }: { label: string; configs: FlightConfig[]; sub: ConfigsTab }) {
  const { t } = useTranslation();
  const tree = useWorkspaceStore((s) => s.tree);
  const setSelectedConfigId = useWorkspaceStore((s) => s.setSelectedConfigId);
  const setConfigsTab = useWorkspaceStore((s) => s.setConfigsTab);
  const setTab = useWorkspaceStore((s) => s.setTab);
  if (!configs.length) return null;

  return (
    <p className="mt-1 text-[11px] leading-snug text-amber-300/90">
      {label}{' '}
      {configs.map((c, i) => (
        <span key={c.id}>
          {i > 0 && ', '}
          <button
            type="button"
            onClick={() => {
              // Open the tab ON that configuration's own table, so the values
              // this line is warning about are the ones on screen.
              setSelectedConfigId(c.id);
              setConfigsTab(sub);
              setTab('configs');
            }}
            className="underline decoration-dotted hover:text-amber-200"
          >
            {c.name || loadoutLabel(tree, c) || t('configs.noMotors')}
          </button>
        </span>
      ))}
    </p>
  );
}
