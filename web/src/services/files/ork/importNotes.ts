import type { OrkFlightConfig } from '../orkTypes';
import { keyedNote, type ImportNote } from '../importNote';

/**
 * The notes an import surfaces about the file's parts and flight
 * configurations: the component tags a reader skipped, and what the file's
 * configurations mean for the one that was opened.
 */

/**
 * One note per component tag a reader skipped. The readers are the only source
 * of these notes; the loader passes them through without adding its own.
 */
export function ignoredNotes(ignored: Set<string>): ImportNote[] {
  return [...ignored].map((name) => keyedNote('importNote.skippedUnsupported', { name }));
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
