// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { unzipSync } from 'fflate';
import { downloadRocket3mf } from '../../../src/services/exports/rocketPrintExport';
import * as saveFile from '../../../src/services/files/saveFile';
import type { RocketTree } from '../../../src/engine/openRocketEngine';

const tree = {
  name: 'Bertha',
  components: [
    {
      type: 'stage',
      id: 's',
      children: [{ type: 'bodytube', id: 'b', name: 'Body', length: 0.2, outerRadius: 0.0125, thickness: 0.0005 }],
    },
  ],
} as unknown as RocketTree;

afterEach(() => vi.restoreAllMocks());

/**
 * The whole-rocket print file is named the way every export is: rocket, then
 * what the file is. A bare "Bertha.3mf" says which rocket and not which document.
 */
describe('downloadRocket3mf', () => {
  it('names the single file rocket plus what it is', async () => {
    const spy = vi.spyOn(saveFile, 'saveBlob').mockResolvedValue(undefined as never);
    await downloadRocket3mf('Bertha', tree);
    expect(spy.mock.calls[0]![1]).toBe('Bertha-print.3mf');
  });

  /**
   * A part name comes from the design, which can be a shared `.ork`. A name
   * with no letter or digit must not become a zip entry as written: `../..`
   * points outside the folder it is extracted into, and `:` or `*` fails the
   * whole archive on Windows.
   */
  it('names a separate file safely when the part name has no letter or digit', async () => {
    const odd = {
      ...tree,
      components: [
        {
          type: 'stage',
          id: 's',
          children: [
            { type: 'bodytube', id: 'b1', name: '../..', length: 0.2, outerRadius: 0.0125, thickness: 0.0005 },
            { type: 'bodytube', id: 'b2', name: ':*', length: 0.2, outerRadius: 0.0125, thickness: 0.0005 },
          ],
        },
      ],
    } as unknown as RocketTree;
    const spy = vi.spyOn(saveFile, 'saveBlob').mockResolvedValue(undefined as never);
    await downloadRocket3mf('Bertha', odd, { separateFiles: true });
    const zip = new Uint8Array(await (spy.mock.calls[0]![0] as Blob).arrayBuffer());
    const names = Object.keys(unzipSync(zip));
    expect(names).toHaveLength(2);
    for (const name of names) expect(name).toMatch(/^[a-z0-9._-]+\.3mf$/i);
    for (const name of names) expect(name).not.toMatch(/^\.\./);
  });
});
