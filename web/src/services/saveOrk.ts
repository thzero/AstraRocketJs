import { zipSync, strToU8 } from 'fflate';
import { exportOrk, type OrkTreeExportInput } from './orkFile';

/** Build a .ork (zip containing rocket.ork) Blob from an export input. */
export function orkBlob(input: OrkTreeExportInput): Blob {
  const xml = exportOrk(input);
  const zipped = zipSync({ 'rocket.ork': strToU8(xml) }, { level: 6 });
  return new Blob([zipped as BlobPart], { type: 'application/vnd.openrocket.ork' });
}

/** Export a design as a .ork file the user downloads. */
export function downloadOrk(input: OrkTreeExportInput): void {
  const url = URL.createObjectURL(orkBlob(input));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(input.name || 'rocket').trim().replace(/[^a-z0-9._-]+/gi, '_') || 'rocket'}.ork`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
