import { PLUGGED_DELAY } from '../../engine/openRocketEngine';
import { escapeXml } from '../xmlUtil';
import { uuid } from '../uuid';
import type { OrkExportMotor, OrkTreeExportInput } from '../orkTypes';
import type { OrkWriteConfig, OrkWriter } from './exportWriter';

/**
 * Flight configurations on the way OUT: which configurations a save writes
 * (and which is the default), the rocket-level <motorconfiguration> table, and
 * the per-mount <motormount> block that lists each configuration's motor and
 * ignition settings.
 */

/**
 * The configurations to write. Classic path (no configs): ONE minted
 * config carrying the working set — exactly the pre-Stage-B output.
 */
export function resolveWriteConfigs(
  input: Pick<OrkTreeExportInput, 'motors' | 'motor' | 'mountId' | 'configs' | 'activeConfigId'>,
): { writeConfigs: OrkWriteConfig[]; defaultId: string } {
  const { motors, motor, mountId, configs, activeConfigId } = input;
  const motorMap: Record<string, OrkExportMotor> = { ...(motors ?? {}) };
  if (motor && mountId && !motorMap[mountId]) motorMap[mountId] = motor;
  const active = configs?.find((c) => c.id === activeConfigId) ?? null;
  const writeConfigs: OrkWriteConfig[] =
    configs && configs.length > 0
      ? configs.map((c) => ({
          id: c.id,
          name: c.name,
          motors: c === active ? motorMap : c.motors,
          deployments: c === active ? null : (c.deployments ?? {}),
        }))
      : [{ id: uuid(), name: null, motors: motorMap, deployments: null }];
  // Active = none but motors loaded: mint an extra config carrying the live
  // set, unnamed (the desktop renders unnamed configs as their motor list).
  const minted =
    configs && configs.length > 0 && !active && Object.keys(motorMap).length > 0
      ? { id: uuid(), name: null, motors: motorMap, deployments: null }
      : null;
  if (minted) writeConfigs.push(minted);
  // default="true" (also what <simulation> references): the active config,
  // else the minted custom one, else the original default.
  const defaultId =
    active?.id ??
    minted?.id ??
    (configs && configs.length > 0 ? (configs.find((c) => c.isDefault)?.id ?? configs[0]!.id) : writeConfigs[0]!.id);
  return { writeConfigs, defaultId };
}

/** The rocket-level <motorconfiguration> declarations, one per write config. */
export function motorConfigurationsXml(w: OrkWriter, depth: number, stageCount: number): void {
  for (const c of w.writeConfigs) {
    w.emit(depth, `<motorconfiguration configid="${escapeXml(c.id)}"${c.id === w.defaultId ? ' default="true"' : ''}>`);
    if (c.name !== null) w.emit(depth + 1, `<name>${escapeXml(c.name)}</name>`);
    for (let i = 0; i < stageCount; i++) {
      w.emit(depth + 1, `<stage number="${i}" active="true"/>`);
    }
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
