import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { MATERIAL_SLOTS, defaultMaterialPatch } from '../../src/services/design/materialSlots';
import { loadEngine } from '../testing/kernelGeometry';
import { KERNEL_TEST_TIMEOUT_MS } from '../testing/kernelTimeout';

vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS, hookTimeout: KERNEL_TEST_TIMEOUT_MS });

/**
 * Notes that describe what the kernel does say what it does. Each case takes
 * its fact from the kernel through the bridge, then holds the English text to
 * it; the other locales translate the English.
 */

const en = JSON.parse(readFileSync(join(__dirname, '../../src/i18n/locales/en.json'), 'utf8')) as {
  aero: { rollNote: string };
  settings: { materialNoDefault: string };
};

/** Every part with a material slot, outside parts on the stage and the rest in a tube. */
const OUTSIDE = new Set(['nosecone', 'bodytube', 'transition']);
const parts = [...new Set(MATERIAL_SLOTS.map((s) => s.part))];
const design = {
  components: [
    {
      type: 'stage',
      id: 'st',
      children: [
        ...parts.filter((p) => OUTSIDE.has(p)).map((p) => ({ type: p, id: p })),
        {
          type: 'bodytube',
          id: 'host',
          outerRadius: 0.03,
          length: 0.6,
          children: parts.filter((p) => !OUTSIDE.has(p)).map((p) => ({ type: p, id: p })),
        },
      ],
    },
  ],
};

describe('the roll dynamics note', () => {
  /** Roll damping of each fin set in a one-Mach sweep at this roll rate (rad/s). */
  const damping = async (rollRate: number): Promise<number[]> => {
    const engine = await loadEngine();
    engine.reset();
    const handle = engine.buildRocket(JSON.stringify(design));
    const sweep = JSON.parse(
      engine.getAeroSweep(
        handle,
        JSON.stringify({ machMin: 0.3, machMax: 0.3, machStep: 0.05, aoaDeg: 0, thetaDeg: 0, rollRate }),
      ),
    ) as { components: { type: string; rollDamp: number[] }[] };
    return sweep.components.filter((c) => /FinSet/.test(c.type)).map((c) => c.rollDamp[0]!);
  };

  it('says the sweep is flown at the chosen roll rate, which is where the kernel computes damping', async () => {
    const still = await damping(0);
    expect(still.length).toBeGreaterThanOrEqual(3);
    for (const d of still) expect(d).toBe(0);
    for (const rate of [1, 10, -5]) for (const d of await damping(rate)) expect(Math.abs(d)).toBeGreaterThan(0);

    expect(en.aero.rollNote).toMatch(/flown at the chosen roll rate/);
    expect(en.aero.rollNote).not.toMatch(/flown at zero roll/);
  });
});

describe('the "no default" material choice', () => {
  it('says the part gets the stock material, which is what the kernel builds a bare part with', async () => {
    const engine = await loadEngine();
    engine.reset();
    const handle = engine.buildRocket(JSON.stringify(design));
    for (const { part, material } of MATERIAL_SLOTS) {
      const fields = JSON.parse(engine.getComponentFields(handle, part)) as Record<string, unknown>;
      const kernel = part === 'parachute' && material === 'line' ? fields.lineMaterialName : fields.materialName;
      expect(kernel, `${part} ${material}`).toEqual(expect.stringMatching(/\S/));
      // And a new part with nothing chosen in Settings is stamped with it.
      expect(Object.values(defaultMaterialPatch(part, {})), `${part} ${material}`).toContain(kernel);
    }

    expect(en.settings.materialNoDefault).toMatch(/stock material/);
    expect(en.settings.materialNoDefault).not.toMatch(/unset/);
  });
});
