// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { defaultNode } from '../../../src/services/design/treeEdit';
import type { ComponentNode } from '../../../src/engine/openRocketEngine';
import { KERNEL_MATERIALS } from '../../../src/tree/kernelDefaults';
import { loadEngine } from '../../testing/kernelGeometry';
import { KERNEL_TEST_TIMEOUT_MS } from '../../testing/kernelTimeout';

/** The kernel's reading of one recovery device, built inside a body tube. */
const info = async (part: ComponentNode): Promise<Record<string, number>> => {
  const engine = await loadEngine();
  engine.reset();
  const handle = engine.buildRocket(
    JSON.stringify({
      components: [
        { type: 'nosecone', id: 'n', length: 0.1, aftRadius: 0.013 },
        { type: 'bodytube', id: 'b', length: 0.3, outerRadius: 0.013, children: [{ ...part, id: 'probe' }] },
      ],
    }),
  );
  const out = JSON.parse(engine.getComponentInfo(handle, 'probe')) as Record<string, number> & { error?: string };
  if (out.error) throw new Error(out.error);
  return out;
};

describe('the kernel reports a recovery device as it flies it', () => {
  /**
   * `Streamer.getComponentCD`, written out: 0.034 ((rho + 0.025) / 0.105)
   * (L + 1) / L, capped at 0.4, with rho the strip's surface density and L its
   * length. A new streamer is a 0.5 m strip of the stock ripstop nylon.
   */
  it(
    "gives a new streamer's automatic drag coefficient",
    async () => {
      const streamer = defaultNode('streamer');
      const L = streamer['stripLength'] as number;
      const rho = KERNEL_MATERIALS.surface.density;
      const expected = Math.min(0.4, ((0.034 * (rho + 0.025)) / 0.105) * ((L + 1) / L));
      expect((await info(streamer)).cd).toBeCloseTo(expected, 12);
    },
    KERNEL_TEST_TIMEOUT_MS,
  );

  it(
    'gives a stated drag coefficient once it is off automatic',
    async () => {
      expect((await info({ ...defaultNode('streamer'), cd: 0.7, cdAuto: false })).cd).toBeCloseTo(0.7, 12);
    },
    KERNEL_TEST_TIMEOUT_MS,
  );

  /** `Parachute.setLineCount` takes 0, and the desktop spinner starts there. */
  it(
    'builds a parachute with no shroud lines',
    async () => {
      const chute = { ...defaultNode('parachute'), lineCount: 0 };
      await expect(info(chute)).resolves.toBeDefined();
    },
    KERNEL_TEST_TIMEOUT_MS,
  );
});
