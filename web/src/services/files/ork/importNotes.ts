import type { ComponentNode } from '../../../engine/openRocketEngine';
import type { OrkFlightConfig } from '../orkTypes';
import { walkNodes } from '../../../tree/treeWalk';
import { keyedNote, type ImportNote } from '../importNote';

/**
 * The honesty notes an import surfaces: what the reader preserved but the
 * simulation does not act on, and what the file's flight configurations mean
 * for the one that was opened.
 */

/**
 * Honesty note for what this reader preserves but the simulation does not act
 * on: repeated instances (other than pod sets and boosters). Saying so beats a
 * silent discrepancy: instances change mass, and mass changes the stability the
 * user is designing to.
 */
export function modelingNotes(components: ComponentNode[]): ImportNote[] {
  const notes: ImportNote[] = [];
  const allNodes = [...walkNodes(components)];
  const instanced = allNodes.filter(
    (nd) =>
      typeof nd['instanceCount'] === 'number' &&
      nd['instanceCount'] > 1 &&
      nd.type !== 'parallelstage' &&
      nd.type !== 'podset',
  );
  if (instanced.length > 0) {
    notes.push(
      keyedNote('importNote.instanced', {
        names: [...new Set(instanced.map((nd) => nd.name ?? nd.type))].join(', '),
      }),
    );
  }
  return notes;
}

/** The one note naming the component tags a reader skipped, if it skipped any. */
export function ignoredNotes(ignored: Set<string>): ImportNote[] {
  return ignored.size ? [keyedNote('importNote.ignored', { names: [...ignored].join(', ') })] : [];
}

/**
 * Multi-config notes: what a file's flight configurations say that is worth
 * flagging on the way in.
 *
 * Every configuration is imported, with its motors, its recovery, its staging
 * and which stages it grounds, so there is nothing left to warn about being
 * dropped. What remains is a file that declares configurations and carries no
 * motors for them, and the hand-rolled case below.
 */
export function configNotes(rocketEl: Element, configs: OrkFlightConfig[]): ImportNote[] {
  const notes: ImportNote[] = [];
  if (configs.length > 1) {
    const mountMotorEls = Array.from(rocketEl.querySelectorAll('motormount > motor'));
    if (mountMotorEls.length === 0) {
      // Declared configs but no <motor> in any mount: worth flagging that the
      // mounts came in empty (nothing to simulate until a motor is picked).
      notes.push(keyedNote('importNote.configsNoMotors', { total: configs.length }));
    }
  } else if (configs.length === 0) {
    // Hand-rolled files may key <motor configid>s without declaring the configs,
    // so those configurations have no names at all. We read the first motor and
    // drop the rest; say how many, but never a UUID (it means nothing to anyone).
    const strayIds = new Set<string>();
    for (const m of Array.from(rocketEl.getElementsByTagName('motor'))) {
      const id = m.getAttribute('configid');
      if (id) strayIds.add(id);
    }
    if (strayIds.size > 1) {
      notes.push(keyedNote('importNote.strayConfigs', { total: strayIds.size }));
    }
  }
  return notes;
}
