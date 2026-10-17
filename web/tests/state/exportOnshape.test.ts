import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from '../../src/state/store';
import { selectConfig } from '../../src/state/workspaceSelectors';
import { saveBlob } from '../../src/services/files/saveFile';
import type { MotorSpec, RocketTree } from '../../src/engine/openRocketEngine';
import en from '../../src/i18n/locales/en.json';

// The file is written through saveBlob, which needs a browser; the test reads
// the blob it was handed.
vi.mock('../../src/services/files/saveFile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/files/saveFile')>()),
  saveBlob: vi.fn(async () => {}),
}));

const s = () => useWorkspaceStore.getState();

/** A nose, a tube with a motor mount, and a camera shroud the feature cannot build. */
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
          children: [
            {
              type: 'innertube',
              id: 'mm',
              length: 0.07,
              outerRadius: 0.009,
              thickness: 0.0005,
              motorMount: true,
              motorOverhang: 0.005,
              position: { method: 'bottom', offset: 0 },
            },
            { type: 'fairing', id: 'cam', name: 'Camera' },
          ],
        },
      ],
    },
  ],
} as unknown as RocketTree;

const C6 = { designation: 'C6', manufacturer: 'Estes', diameter: 0.018, length: 0.07, ejectionDelay: 5 } as MotorSpec;

/** The payload handed to the last download, parsed. */
const written = async (): Promise<{ rocket: { components: Record<string, unknown>[] } }> => {
  const blob = vi.mocked(saveBlob).mock.calls.at(-1)![0];
  return JSON.parse(await blob.text()) as never;
};

beforeEach(() => {
  s().resetWorkspace();
  useWorkspaceStore.setState({ err: null, tree });
  vi.mocked(saveBlob).mockClear();
});

describe('exportJson', () => {
  it("seats the selected configuration's motor in its mount", async () => {
    const active = selectConfig(s());
    useWorkspaceStore.setState({
      configs: s().configs.map((c) => (c.id === active.id ? { ...c, motors: { mm: { spec: C6 } } } : c)),
    });
    await s().exportJson();
    expect(vi.mocked(saveBlob).mock.calls[0]![1]).toBe('x-design.json');
    const stage = (await written()).rocket.components[0] as {
      children: { children: { id: string; params: never }[] }[];
    };
    const mount = stage.children[1]!.children.find((c) => c.id === 'mm')!.params as {
      isMotorMount: boolean;
      motorMount: Record<string, unknown>;
    };
    expect(mount.isMotorMount).toBe(true);
    expect(mount.motorMount).toMatchObject({
      designation: 'C6',
      manufacturer: 'Estes',
      diameter: 0.018,
      length: 0.07,
      overhang: 0.005,
      selectedConfigId: active.id,
    });
  });

  it('leaves out a part the feature cannot build, and says which', async () => {
    await s().exportJson();
    const stage = (await written()).rocket.components[0] as { children: { children: { id: string }[] }[] };
    expect(stage.children[1]!.children.map((c) => c.id)).toEqual(['mm']);
    expect(s().err).toBe(en.errors.exportJsonPartial.replace('{{parts}}', 'Camera'));
  });
});
