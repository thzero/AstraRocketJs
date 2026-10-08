import { PLUGGED_DELAY } from '../../../engine/openRocketEngine';
import { escapeXml } from '../xmlUtil';
import { uuid } from '../../app/uuid';
import type { OrkTreeExportInput } from '../orkTypes';
import type { OrkWriteConfig, OrkWriter } from './exportWriter';

/**
 * Flight configurations on the way out: which configurations a save writes
 * (and which is the default), the rocket-level <motorconfiguration> table, and
 * the per-mount <motormount> block that lists each configuration's motor and
 * ignition settings.
 */

/**
 * The configurations to write, and which of them is the file's default.
 *
 * What the app holds, written as it stands: a design has flight configurations
 * (services/flight/flightConfigs.ts), and each one carries its own motors. A design
 * with none at all (a `.rkt` on its way out, or a rocket with no mounts) gets
 * one unnamed configuration minted here, because every `<motormount>` block
 * keys its motors by a `configid` and the file has to declare one for them.
 *
 * A configuration that overrides no deployment writes `null`, which the device
 * writers read as "recovers the way the design says" - the bare tags each device
 * already carries. One that overrides something writes its own block, whether or
 * not it is the default.
 */
export function resolveWriteConfigs(input: Pick<OrkTreeExportInput, 'configs' | 'activeConfigId'>): {
  writeConfigs: OrkWriteConfig[];
  defaultId: string;
} {
  const { configs, activeConfigId } = input;
  if (!configs?.length) {
    const minted = { id: uuid(), name: null, motors: {}, deployments: null, separations: null, grounded: [] };
    return { writeConfigs: [minted], defaultId: minted.id };
  }
  const defaultId = configs.find((c) => c.id === activeConfigId)?.id ?? configs[0]!.id;
  const writeConfigs: OrkWriteConfig[] = configs.map((c) => ({
    id: c.id,
    name: c.name,
    motors: c.motors,
    deployments: c.deployments ?? null,
    separations: c.separations ?? null,
    grounded: c.grounded ?? [],
  }));
  return { writeConfigs, defaultId };
}

/** The rocket-level <motorconfiguration> declarations, one per write config. */
export function motorConfigurationsXml(w: OrkWriter, depth: number, stageIds: (string | undefined)[]): void {
  for (const c of w.writeConfigs) {
    w.emit(depth, `<motorconfiguration configid="${escapeXml(c.id)}"${c.id === w.defaultId ? ' default="true"' : ''}>`);
    if (c.name !== null) w.emit(depth + 1, `<name>${escapeXml(c.name)}</name>`);
    // One flag per stage, in the kernel's own numbering (see treeEdit.findStages,
    // which is the walk this list comes from). A grounded stage says so here;
    // that is the whole of what stage activeness is in the file.
    stageIds.forEach((id, i) => {
      const active = !(id && c.grounded.includes(id));
      w.emit(depth + 1, `<stage number="${i}" active="${active}"/>`);
    });
    w.emit(depth, '</motorconfiguration>');
  }
}

/** The write-configs that hold a motor for this mount, in write order. */
export function mountConfigs(w: OrkWriter, nodeId: string | undefined): OrkWriteConfig[] {
  return nodeId ? w.writeConfigs.filter((c) => c.motors[nodeId]) : [];
}

// Configs may all be empty here: a mount with no motor loaded still writes
// <motormount> so the mount flag survives the round trip (desktop same).
export function motorMountXml(w: OrkWriter, depth: number, nodeId: string | undefined, overhangM = 0): void {
  const { emit } = w;
  const withMotor = mountConfigs(w, nodeId);
  // Bare ignition defaults: the default-marked config's motor when it has
  // one here (the desktop writes its default config bare), else the first.
  const bare = (withMotor.find((c) => c.id === w.defaultId) ?? withMotor[0])?.motors[nodeId!];
  const ev = bare?.ignitionEvent ?? 'automatic';
  const evDelay = bare?.ignitionDelay ?? 0;
  emit(depth, '<motormount>');
  emit(depth + 1, `<ignitionevent>${escapeXml(ev)}</ignitionevent>`);
  emit(depth + 1, `<ignitiondelay>${evDelay}</ignitiondelay>`);
  emit(depth + 1, `<overhang>${overhangM}</overhang>`);
  for (const c of withMotor) {
    const m = c.motors[nodeId!]!;
    emit(depth + 1, `<motor configid="${escapeXml(c.id)}">`);
    emit(depth + 2, '<type>single</type>');
    emit(depth + 2, `<manufacturer>${escapeXml(m.manufacturer ?? 'custom')}</manufacturer>`);
    // Between manufacturer and designation, where the desktop writes it. Which
    // of its database entries this motor is: without it a name shared by
    // several resolves to whichever comes first, with a warning saying so.
    if (m.digest) emit(depth + 2, `<digest>${escapeXml(m.digest)}</digest>`);
    emit(depth + 2, `<designation>${escapeXml(m.designation)}</designation>`);
    emit(depth + 2, `<diameter>${m.diameter}</diameter>`);
    emit(depth + 2, `<length>${m.length}</length>`);
    // Plugged (no ejection charge) → the desktop's literal "none".
    emit(depth + 2, `<delay>${m.delay >= PLUGGED_DELAY ? 'none' : m.delay}</delay>`);
    emit(depth + 1, '</motor>');
  }
  for (const c of withMotor) {
    const m = c.motors[nodeId!]!;
    emit(depth + 1, `<ignitionconfiguration configid="${escapeXml(c.id)}">`);
    emit(depth + 2, `<ignitionevent>${escapeXml(m.ignitionEvent ?? 'automatic')}</ignitionevent>`);
    emit(depth + 2, `<ignitiondelay>${m.ignitionDelay ?? 0}</ignitiondelay>`);
    emit(depth + 1, '</ignitionconfiguration>');
  }
  emit(depth, '</motormount>');
}
