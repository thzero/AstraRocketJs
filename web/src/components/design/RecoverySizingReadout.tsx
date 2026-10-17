import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ComponentNode, FlightResult } from '../../engine/openRocketEngine';
import { useUnits } from '../../prefs/useUnits';
import { unitScope } from '../../prefs/units';
import { num } from '../../tree/nodeProps';
import { useWorkspaceStore, selectActive, selectConfig, selectOutdated } from '../../state/store';
import { motorSpecs } from '../../services/flight/flightConfigs';
import { deviceDescent, sharedDeviceNames, type RecoveryDeviceRef } from '../../services/flight/recoveryFlown';
import { isDefaultComponentName, kernelComponentName } from '../../services/app/warningText';
import { flightBranches } from '../../services/flight/flightColumns';
import { stageLabel } from '../../i18n/format';
import { airDensity, descentMass } from '../../services/flight/recoverySizing';
import { Dialog } from '../common/Dialog';
import { SizingFigures } from '../tools/SizingFigures';
import type { NodeEditProps } from './DimensionFields';

/**
 * Descent-sizing help for a selected parachute, opened from its editor as a
 * dialog, with a button per suggested diameter that sets it on the canopy.
 *
 * An estimate, and it says so. The mass is the loaded mass less the propellant
 * that burns off, the rate comes from the descent equation at a launch-site air
 * density of our own, and the two diameters are that equation solved backwards.
 * None of it is the kernel's, which is why it can be shown before the design has
 * ever flown and why it must not be mistaken for a result.
 *
 * Once a run has flown this device the mass and the rate are replaced by what the
 * kernel recorded (`recoveryFlown`), and the block says which it is showing. The
 * two diameters stay an estimate throughout: "what size should I use" is a
 * question about a design, and no flight can answer it.
 *
 * The suggestion is worth more against the measured mass than against ours, so
 * when a run is available every line is computed from that one.
 *
 * Reads the workspace store directly so PropertyPanel needn't thread it through.
 */
export function RecoverySizingReadout({ node, onChange, onCommit }: NodeEditProps) {
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
  // An outdated run describes a design or settings that have since moved, so its
  // figures are not this device's any more; the estimate is the honest fallback.
  const result = useWorkspaceStore((s) => (selectOutdated(s) ? null : selectActive(s).result));

  // The stored Cd is the one the kernel flies, Auto or not: a parachute's
  // `getComponentCD` returns its stored `cd` (Parachute.java), so `cdAuto` on
  // this part changes nothing, and the kernel's default for a chute with no
  // `cd` is the same 0.8 (RecoverySizingReadout.kernel.test pins both).
  //
  // `num(..., 0.8)`, not `num(...) || 0.8`: the `||` fallback would also replace
  // a stored `cd: 0`, whose infinite descent rate `descentRate` renders as a
  // dash.
  const cd = num(node, 'cd', 0.8);
  const diameter = num(node, 'diameter');

  // The device as the run's deployment events know it: by its node id, and by
  // the name the kernel flies it under for a result that carries no ids. For an
  // unnamed device that name is the kernel's default, which every other unnamed
  // device of its type shares.
  const device = useMemo(() => {
    const name = kernelComponentName(node);
    return { id: node.id, name, nameShared: sharedDeviceNames(tree.components).has(name) };
  }, [node, tree]);
  const sizing = useMemo(() => {
    // What the run recorded for this device, if it flew one.
    const flown = deviceDescent(result, device);
    const mass = flown?.mass ?? descentMass(info?.mass, motorSpecs(tree, config));
    if (mass == null) return null;
    return {
      mass,
      rate: flown?.rate ?? null,
      measured: flown != null,
      branch: flown && result ? branchName(t, result, flown, device) : '',
    };
  }, [info?.mass, tree, config, result, device, t]);

  if (sizing == null) return <p className="mt-3 text-xs text-ink-muted">{t('recovery.needsMotor')}</p>;
  return (
    <div className="mt-3 space-y-3">
      <p className="text-xs text-ink-muted">
        {/* Three keys, not one with a conditional clause: i18next cannot
            omit a fragment, and gluing the branch name on here would not
            translate. The branch is named only when the flight had more than
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

/**
 * The branch a device deployed on, as every other view names a stage. A stage
 * whose name was cleared flies under the kernel's default, a bundle key the
 * TeaVM kernel cannot look up, so it reads "Stage n" by its place in the flight
 * instead. Empty for a single-branch flight, which has nothing to tell apart.
 */
function branchName(
  t: (key: string, opts?: Record<string, unknown>) => string,
  run: FlightResult,
  at: { branch: string; time: number },
  device: RecoveryDeviceRef,
): string {
  if (!at.branch) return '';
  const index = flightBranches(run).findIndex(
    (b) =>
      b.name === at.branch &&
      (b.events ?? []).some(
        (e) => e.time === at.time && (e.sourceId != null ? e.sourceId === device.id : e.source === device.name),
      ),
  );
  return stageLabel(t, Math.max(index, 0), isDefaultComponentName(at.branch) ? '' : at.branch);
}
