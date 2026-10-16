import { describe, it, expect, vi } from 'vitest';
import { importCustomMotors, loadCatalog } from '../../../src/services/motors/motorDb';
import type { CustomMotor } from '../../../src/services/motors/motorStore';

/**
 * Several motor files in one import, the way desktop loads a folder of thrust
 * curves: one store write, and a file that cannot be read is named rather than
 * stopping the rest.
 */
const added: unknown[][] = [];
let stored: CustomMotor[] = [];
vi.mock('../../../src/services/app/remoteData', () => ({ fetchCatalog: vi.fn(async () => []) }));
vi.mock('../../../src/services/motors/motorStore', () => ({
  getMotorStore: () => ({
    listCustomMotors: async () => stored,
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

  it('names a picked file too large to read and imports the rest', async () => {
    added.length = 0;
    const fits = new Blob([eng('A1')]);
    // Only the size is read before the refusal, so no bytes need to exist.
    const huge = { size: 1024 * 1024 * 1024, arrayBuffer: () => Promise.reject(new Error('unread')) } as Blob;
    const out = await importCustomMotors([
      { name: 'a.eng', blob: fits },
      { name: 'huge.eng', blob: huge },
    ]);
    expect(out.imported).toBe(1);
    expect(out.failed).toEqual(['huge.eng']);
  });

  it('reports the parser’s own error when nothing can be read', async () => {
    await expect(importCustomMotors([{ name: 'bad.eng', text: 'not a motor' }])).rejects.toThrow();
  });
});

describe('importCustomMotors with one motor under several delays', () => {
  // The id drops the delay, so the three blocks are one motor; it must offer
  // all three delays, and the count must be what the store holds.
  const block = (delay: number) => `C6-${delay} 18 70 ${delay} 0.0108 0.0242 Estes\n0 0\n0.2 14\n1.7 0\n`;

  it('stores one motor carrying every delay and reports one', async () => {
    added.length = 0;
    const out = await importCustomMotors([{ name: 'c6.eng', text: block(3) + block(7) + block(5) }]);
    expect(out.imported).toBe(1);
    const batch = added[0] as CustomMotor[];
    expect(batch).toHaveLength(1);
    expect(batch[0]!.id).toBe('custom:Estes:C6');
    expect(batch[0]!.delayList).toBe('3,5,7');
  });

  it('keeps a plugged listing through the merge', async () => {
    added.length = 0;
    const plugged = 'C6-P 18 70 P 0.0108 0.0242 Estes\n0 0\n0.2 14\n1.7 0\n';
    await importCustomMotors([{ name: 'c6.eng', text: block(5) + plugged }]);
    expect((added[0] as CustomMotor[])[0]!.delayList).toBe('5,P');
  });
});

describe('a stored custom motor in the catalog', () => {
  it('takes impulse, class and burn from the finalized curve', async () => {
    // Raw samples with no t = 0 point, and out of order. Finalized, the curve
    // is (0, 0), (1, 36), (1.5, 0): impulse 0.5*1*36 + 0.5*0.5*36 = 27 Ns, an
    // E. The raw tail alone is 9 Ns, a C.
    stored = [
      {
        id: 'custom:T:X1',
        designation: 'X1',
        manufacturer: 'T',
        class: 'C',
        diameter: 18,
        length: 70,
        totalWeightG: 30,
        propWeightG: 10,
        samples: [
          { time: 1.5, thrust: 0 },
          { time: 1, thrust: 36 },
        ],
        source: 'eng',
      },
    ];
    try {
      const [row] = await loadCatalog();
      expect(row!.impulse).toBeCloseTo(27, 9);
      expect(row!.class).toBe('E');
      expect(row!.burn).toBe(1.5);
    } finally {
      stored = [];
    }
  });
});
