import { describe, it, expect, vi } from 'vitest';
import { importCustomMotors } from '../../../src/services/motors/motorDb';

/**
 * Several motor files in one import, the way desktop loads a folder of thrust
 * curves: one store write, and a file that cannot be read is named rather than
 * stopping the rest.
 */
const added: unknown[][] = [];
vi.mock('../../../src/services/app/remoteData', () => ({ fetchCatalog: vi.fn(async () => []) }));
vi.mock('../../../src/services/motors/motorStore', () => ({
  getMotorStore: () => ({
    listCustomMotors: async () => [],
    addCustomMotors: async (m: unknown[]) => void added.push(m),
  }),
}));

const eng = (name: string) => `; test\n${name} 18 70 0 0.0062 0.0175 Test\n0.1 10\n0.5 5\n0.8 0\n;`;

describe('importCustomMotors with several files', () => {
  it('imports every readable file in one write and names the rest', async () => {
    added.length = 0;
    const out = await importCustomMotors([
      { name: 'a.eng', text: eng('A1') },
      { name: 'bad.eng', text: 'not a motor' },
      { name: 'b.eng', text: eng('B2') },
    ]);
    expect(out.imported).toBe(2);
    expect(out.failed).toEqual(['bad.eng']);
    expect(added).toHaveLength(1);
    expect(added[0]).toHaveLength(2);
  });

  it('names an oversized motor file as failed rather than parsing it', async () => {
    added.length = 0;
    const huge = eng('H1') + ' '.repeat(64 * 1024 * 1024);
    const out = await importCustomMotors([
      { name: 'a.eng', text: eng('A1') },
      { name: 'huge.eng', text: huge },
    ]);
    expect(out.imported).toBe(1);
    expect(out.failed).toEqual(['huge.eng']);
  });

  it('reports the parser’s own error when nothing can be read', async () => {
    await expect(importCustomMotors([{ name: 'bad.eng', text: 'not a motor' }])).rejects.toThrow();
  });
});
