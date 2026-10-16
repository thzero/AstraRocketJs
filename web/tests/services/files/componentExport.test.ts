// cspell:ignore Rumpfrohr
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RocketTree } from '../../../src/engine/openRocketEngine';

const downloads = vi.hoisted(() => [] as string[]);
vi.mock('../../../src/services/files/saveFile', async (orig) => {
  const real = await orig<typeof import('../../../src/services/files/saveFile')>();
  return { ...real, download: (name: string) => void downloads.push(name) };
});

import { exportComponent } from '../../../src/services/files/componentExport';
import i18n from '../../../src/i18n';

/**
 * An unnamed part's file is named the way every view names the part: by its
 * translated type, not by the type token the tree stores.
 */
describe('exportComponent file name', () => {
  const tree = {
    name: 'Alpha',
    components: [
      {
        type: 'stage',
        id: 'st',
        children: [{ type: 'bodytube', id: 'tube', length: 0.3, outerRadius: 0.012, thickness: 0.001 }],
      },
    ],
  } as unknown as RocketTree;

  beforeEach(() => {
    downloads.length = 0;
  });

  it('uses the translated type for a part with no name', async () => {
    expect(await exportComponent(tree, 'tube', 'stl', 'Alpha', (k, v) => i18n.t(k, v))).toBe(true);
    expect(downloads).toEqual(['Alpha-Body_tube.stl']);
  });

  it('follows the UI language when no translator is passed', async () => {
    await i18n.changeLanguage('de');
    try {
      await exportComponent(tree, 'tube', 'stl', 'Alpha');
      expect(downloads).toEqual(['Alpha-Rumpfrohr.stl']);
      expect(downloads[0]).not.toContain('bodytube');
    } finally {
      await i18n.changeLanguage('en');
    }
  });
});
