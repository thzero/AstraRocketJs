// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
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
 * what the file is. A bare "Bertha.3mf" said which rocket and not which document.
 */
describe('downloadRocket3mf', () => {
  it('names the single file rocket plus what it is', async () => {
    const spy = vi.spyOn(saveFile, 'saveBlob').mockResolvedValue(undefined as never);
    await downloadRocket3mf('Bertha', tree);
    expect(spy.mock.calls[0]![1]).toBe('Bertha-print.3mf');
  });
});
