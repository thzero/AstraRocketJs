import type { ComponentNode } from '../../engine/openRocketEngine';
import type { OrkFlightConfig } from '../orkTypes';

/**
 * The honesty notes an import surfaces: what the reader PRESERVED but the
 * simulation does not act on, and what the file's flight configurations mean
 * for the one that was opened.
 */

/**
 * Honesty notes for the two things this reader now PRESERVES but the
 * simulation does not yet act on. Saying so beats a silent discrepancy —
 * both change mass, and mass changes the stability the user is designing to.
 */
export function modelingNotes(components: ComponentNode[]): string[] {
  const notes: string[] = [];
  const allNodes: ComponentNode[] = [];
  const collect = (ns: ComponentNode[]) => {
    for (const nd of ns) {
      allNodes.push(nd);
      collect(nd.children ?? []);
    }
  };
  collect(components);
  const instanced = allNodes.filter(
    (nd) =>
      typeof nd['instanceCount'] === 'number' &&
      (nd['instanceCount'] as number) > 1 &&
      nd.type !== 'parallelstage' &&
      nd.type !== 'podset',
  );
  if (instanced.length > 0) {
    notes.push(
      `${instanced.length} component${instanced.length === 1 ? '' : 's'} in this design ` +
        `(${[...new Set(instanced.map((nd) => nd.name ?? nd.type))].join(', ')}) ` +
        'repeat as multiple instances. The file keeps every instance, but the ' +
        'drawing and the simulation currently show one.',
    );
  }
  return notes;
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
export function configNotes(rocketEl: Element, configs: OrkFlightConfig[]): string[] {
  const notes: string[] = [];
  if (configs.length > 1) {
    const mountMotorEls = Array.from(rocketEl.querySelectorAll('motormount > motor'));
    if (mountMotorEls.length === 0) {
      // Declared configs but no <motor> in any mount: worth flagging that the
      // mounts came in empty (nothing to simulate until a motor is picked).
      notes.push(`File declares ${configs.length} flight configurations but carried no motors to import.`);
    }
  } else if (configs.length === 0) {
    // Hand-rolled files may key <motor configid>s without declaring the configs,
    // so those configurations have no names at all. We read the first motor and
    // drop the rest — say how many, but never a UUID (it means nothing to anyone).
    const strayIds = new Set<string>();
    for (const m of Array.from(rocketEl.getElementsByTagName('motor'))) {
      const id = m.getAttribute('configid');
      if (id) strayIds.add(id);
    }
    if (strayIds.size > 1) {
      notes.push(
        `File has ${strayIds.size} flight configurations — only the first was imported; the other ${strayIds.size - 1} ${strayIds.size - 1 === 1 ? 'was' : 'were'} not.`,
      );
    }
  }
  return notes;
}
