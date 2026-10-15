import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from '../../src/state/store';
import { selectConfig } from '../../src/state/workspaceSelectors';
import { saveBlob } from '../../src/services/files/saveFile';
import type { RocketTree } from '../../src/engine/openRocketEngine';

// The file is written through saveBlob, which needs a browser; the test reads
// the blob it was handed.
vi.mock('../../src/services/files/saveFile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/files/saveFile')>()),
  saveBlob: vi.fn(async () => {}),
}));

const s = () => useWorkspaceStore.getState();

/** A nose, a tube and a parachute that deploys on the ejection charge in the design. */
const tree = {
  name: 'x',
  components: [
    {
      type: 'stage',
      id: 'st',
      children: [
        { type: 'nosecone', id: 'nc', length: 0.1, aftRadius: 0.0124, shape: 'ogive', thickness: 0.001 },
        {
          type: 'bodytube',
          id: 'bt',
          length: 0.3,
          outerRadius: 0.0124,
          thickness: 0.0004,
          children: [{ type: 'parachute', id: 'chute', name: 'Main', deployEvent: 'ejection' }],
        },
      ],
    },
  ],
} as unknown as RocketTree;

beforeEach(() => {
  s().resetWorkspace();
  // The whole rocket's launch mass and CG, as a build leaves them: the single
  // stage's simulation cell. Without a build the export warns that it wrote 0.
  useWorkspaceStore.setState({ err: null, tree, info: { mass: 0.1, cg: 0.2 } as never });
  vi.mocked(saveBlob).mockClear();
});

/**
 * Desktop's RecoveryDTO reads each chute's deployment from the selected flight
 * configuration, so an override there is what the export carries.
 */
describe('saveRasaero', () => {
  it("exports the selected configuration's deployment, not the design's", async () => {
    const active = selectConfig(s());
    useWorkspaceStore.setState({
      configs: s().configs.map((c) =>
        c.id === active.id ? { ...c, deployments: { chute: { deployEvent: 'apogee' as const } } } : c,
      ),
    });
    await s().saveRasaero();
    expect(s().err).toBeNull();
    const blob = vi.mocked(saveBlob).mock.calls[0]![0];
    expect(await blob.text()).toContain('<EventType1>Apogee</EventType1>');
  });

  it("refuses the design's own ejection charge with no override", async () => {
    await s().saveRasaero();
    expect(s().err).toContain('"Main"');
    expect(saveBlob).not.toHaveBeenCalled();
  });
});
