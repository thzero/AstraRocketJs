// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { defaultNode } from '../../../src/services/design/treeEdit';
import type { ComponentNode } from '../../../src/engine/openRocketEngine';
import { loadEngine } from '../../testing/kernelGeometry';
import { KERNEL_TEST_TIMEOUT_MS } from '../../testing/kernelTimeout';

/**
 * A new parachute flies the shroud line length desktop's `Parachute()` gives
 * it: automatic, 1.5 times the canopy diameter (`AUTO_LINE_LENGTH_RATIO`), and
 * still 1.5 times it after the diameter changes. A stated length with no
 * automatic flag would fly as the user's own number.
 */
describe('a new parachute', () => {
  const lineLength = async (chute: ComponentNode): Promise<number> => {
    const engine = await loadEngine();
    engine.reset();
    const tree = {
      components: [
        { type: 'nosecone', id: 'n', length: 0.1, aftRadius: 0.013 },
        { type: 'bodytube', id: 'b', length: 0.3, outerRadius: 0.013, children: [{ ...chute, id: 'probe' }] },
      ],
    };
    const handle = engine.buildRocket(JSON.stringify(tree));
    return JSON.parse(engine.getComponentInfo(handle, 'probe')).lineLength as number;
  };

  it(
    'flies an automatic line length of 1.5 times its diameter',
    async () => {
      const chute = defaultNode('parachute');
      expect(await lineLength(chute)).toBeCloseTo(1.5 * (chute['diameter'] as number), 12);
      expect(await lineLength({ ...chute, diameter: 0.5 })).toBeCloseTo(0.75, 12);
    },
    KERNEL_TEST_TIMEOUT_MS,
  );
});
