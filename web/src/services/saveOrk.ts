import { zipSync, strToU8 } from 'fflate';
import { exportOrk, type OrkTreeExportInput } from './orkFile';
import { saveBlob, exportFilename } from './saveFile';
import type { RocketTree } from '../engine/openRocketEngine';

/** Build a .ork (zip containing rocket.ork) Blob from an export input. */
function orkBlob(input: OrkTreeExportInput): Blob {
  const xml = exportOrk(input);
  const zipped = zipSync({ 'rocket.ork': strToU8(xml) }, { level: 6 });
  return new Blob([zipped as BlobPart], { type: 'application/vnd.openrocket.ork' });
}

/** Export a design as a .ork file the user downloads. */
export function downloadOrk(input: OrkTreeExportInput): void {
  void saveBlob(orkBlob(input), exportFilename([input.name, 'design'], 'ork'));
}

/**
 * Export a design as a RockSim `.rkt` file, returning the component types that
 * had no RockSim element.
 *
 * Plain XML, not a zip: RockSim does not archive its files. The skipped list
 * comes back to the caller rather than being swallowed, so the user is told
 * what is missing from a file they are about to hand to somebody else.
 */
export async function downloadRkt(name: string, tree: RocketTree): Promise<string[]> {
  const { exportRkt } = await import('./rktExport');
  const { xml, skipped } = exportRkt(name, tree);
  await saveBlob(new Blob([xml], { type: 'application/xml' }), exportFilename([name, 'design'], 'rkt'));
  return skipped;
}
