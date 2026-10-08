import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ComponentNode } from '../../engine/openRocketEngine';
import { useUnits } from '../../prefs/useUnits';
import { unitScope } from '../../prefs/units';
import { num } from '../../tree/nodeProps';
import { useWorkspaceStore, selectActive, selectConfig, selectOutdated } from '../../state/store';
import { motorSpecs } from '../../services/flight/flightConfigs';
import { deviceDescent } from '../../services/flight/recoveryFlown';
import { airDensity, descentMass } from '../../services/flight/recoverySizing';
import { Dialog } from '../common/Dialog';
import { SizingFigures } from '../tools/SizingFigures';

/**
 * Descent-sizing help for a selected parachute, opened from its editor as a
 * dialog, with a button per suggested diameter that sets it on the canopy.
 *
 * An ESTIMATE, and it says so. The mass is the loaded mass less the propellant
 * that burns off, the rate comes from the descent equation at a launch-site air
 * density of our own, and the two diameters are that equation solved backwards.
 * None of it is the kernel's, which is why it can be shown before the design has
 * ever flown and why it must not be mistaken for a result.
 *
 * Once a run HAS flown this device the mass and the rate are replaced by what the
 * kernel recorded (`recoveryFlown`), and the block says which it is showing. The
 * two diameters stay an estimate throughout: "what size should I use" is a
 * question about a design, and no flight can answer it.
 *
 * The suggestion is worth more against the measured mass than against ours, so
 * when a run is available every line is computed from that one.
 *
 * Reads the workspace store directly so PropertyPanel needn't thread it through.
 */
export function RecoverySizingReadout({
  node,
  onChange,
  onCommit,
}: {
  node: ComponentNode;
  onChange: (patch: Partial<ComponentNode>) => void;
  onCommit?: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-line/5 pt-3">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-md bg-raised px-3 py-1.5 text-xs font-medium text-ink ring-1 ring-line/10 hover:bg-elevated"
      >
        {t('recovery.open')}
      </button>
      {open && (
        <Dialog
          id="recovery-sizing"
          title={t('recovery.title')}
          onClose={() => setOpen(false)}
          layer="over"
          layout="pad"
          size="md"
        >
          <SizingBody
            node={node}
            onUse={(d) => {
              onChange({ diameter: d });
              onCommit?.();
            }}
          />
        </Dialog>
      )}
    </div>
  );
}

function SizingBody({ node, onUse }: { node: ComponentNode; onUse: (diameterM: number) => void }) {
  const { t } = useTranslation();
  const u = useUnits();
  const massUnit = u.at(unitScope('recovery', 'mass'), 'mass');
  const info = useWorkspaceStore((s) => s.info);
  const tree = useWorkspaceStore((s) => s.tree);
  const config = useWorkspaceStore(selectConfig);
  const launch = useWorkspaceStore((s) => selectActive(s).launch);
  // An OUTDATED run describes a design or settings that have since moved, so its
  // figures are not this device's any more; the estimate is the honest fallback.
  const result = useWorkspaceStore((s) => (selectOutdated(s) ? null : selectActive(s).result));

  // `num(..., 0.8)`, not `|| 0.8`: `nodeProps.num` already returns 0 for an
  // absent or non-finite value, so the truthiness fallback would also swallow a
  // deliberately stored `cd: 0` and report a finite descent rate for a canopy
  // with no drag, instead of the infinite rate `descentRate`'s own guard exists
  // to render as a dash.
  const cd = num(node, 'cd', 0.8);
  const diameter = num(node, 'diameter');

  const name = typeof node.name === 'string' ? node.name : '';
  const sizing = useMemo(() => {
    // What the run recorded for THIS device, if it flew one.
    const flown = deviceDescent(result, name);
    const mass = flown?.mass ?? descentMass(info?.mass, motorSpecs(tree, config));
    if (mass == null) return null;
    return { mass, rate: flown?.rate ?? null, measured: flown != null, branch: flown?.branch ?? '' };
  }, [info?.mass, tree, config, result, name]);

  if (sizing == null) return <p className="mt-3 text-xs text-ink-muted">{t('recovery.needsMotor')}</p>;
  return (
    <div className="mt-3 space-y-3">
      <p className="text-xs text-ink-muted">
        {/* Three keys, not one with a conditional clause: i18next cannot
            omit a fragment, and gluing the branch name on here would not
            translate. The branch is named only when the flight HAD more than
            one, since otherwise there is nothing to distinguish. */}
        {t(
          sizing.measured ? (sizing.branch ? 'recovery.forMassRunBranch' : 'recovery.forMassRun') : 'recovery.forMass',
          { mass: `${massUnit.fmtSym(sizing.mass)}`, branch: sizing.branch },
        )}
      </p>
      <SizingFigures
        massKg={sizing.mass}
        cd={cd}
        rho={airDensity(launch)}
        diameterM={diameter > 0 ? diameter : null}
        rateMs={sizing.rate}
        onUse={onUse}
      />
    </div>
  );
}
