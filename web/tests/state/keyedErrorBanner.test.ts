import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../src/i18n';
import { useWorkspaceStore } from '../../src/state/store';
import type { RocketTree } from '../../src/engine/openRocketEngine';
import de from '../../src/i18n/locales/de.json';
import ja from '../../src/i18n/locales/ja.json';

// The file is written through saveBlob, which needs a browser; what matters
// here is what the banner says about it.
vi.mock('../../src/services/files/saveFile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/files/saveFile')>()),
  saveBlob: vi.fn(async () => {}),
}));

/**
 * The store's export actions catch a service's keyed error and put it in the
 * banner, inside a translated wrapper, in the language the app is showing.
 */

const s = () => useWorkspaceStore.getState();

const stage = (id: string, extra: object[] = []) => ({
  type: 'stage',
  id,
  children: [{ type: 'bodytube', id: `${id}-tube`, length: 0.3, outerRadius: 0.0124, thickness: 0.0004 }, ...extra],
});

beforeEach(() => {
  s().resetWorkspace();
  useWorkspaceStore.setState({ err: null });
});

afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('the export banner, in German', () => {
  it('wraps a RASAero refusal and translates the reason inside it', async () => {
    await i18n.changeLanguage('de');
    const tree = { name: 'x', components: ['a', 'b', 'c', 'd'].map((id) => stage(id)) } as unknown as RocketTree;
    useWorkspaceStore.setState({ tree });
    await s().saveRasaero();
    expect(s().err).toBe(
      de.errors.exportRasaero.replace('{{reason}}', de.errors.rasaero.tooManyStages.replace('{{max}}', '3')),
    );
  });

  // RASAeroCommonConstants.OPENROCKET_TO_RASAERO_SURFACE writes ROUGH and
  // POLISHED as Smooth and adds a warning; the file is still saved.
  it('warns, in German, that a finish with no RASAero surface was written as smooth', async () => {
    await i18n.changeLanguage('de');
    const tree = {
      name: 'x',
      components: [
        {
          ...stage('a'),
          children: [
            { type: 'nosecone', id: 'nc', length: 0.1, aftRadius: 0.0124, shape: 'ogive', finish: 'rough' },
            ...stage('a').children,
          ],
        },
      ],
    } as unknown as RocketTree;
    // Built, so the single stage's simulation cell has its figure and the only
    // warning is the surface one.
    useWorkspaceStore.setState({ tree, info: { mass: 0.1, cg: 0.2 } as never });
    await s().saveRasaero();
    expect(s().err).toBe(de.errors.exportRasaeroSurface);
  });

  it('names what the .rkt left out with the tree type labels, as a German list', async () => {
    await i18n.changeLanguage('de');
    const tree = {
      name: 'x',
      components: [stage('a', [{ type: 'railbutton', id: 'rb' }]), stage('b'), stage('c'), stage('d')],
    } as unknown as RocketTree;
    useWorkspaceStore.setState({ tree });
    await s().saveRkt();
    const parts = new Intl.ListFormat('de', { type: 'conjunction' }).format([
      de.errors.rktSkip.extraStages.replace('{{from}}', '4'),
      de.part.railbutton,
    ]);
    expect(s().err).toBe(de.errors.exportRktPartial.replace('{{parts}}', parts));
    // No raw type token, and nothing English.
    expect(s().err).not.toContain('railbutton');
    expect(s().err).not.toContain('beyond');
  });
});

describe('the export banner, in Japanese', () => {
  it('lists the skipped parts with Japanese punctuation', async () => {
    await i18n.changeLanguage('ja');
    const tree = {
      name: 'x',
      components: [
        stage('a', [
          { type: 'railbutton', id: 'rb' },
          { type: 'fairing', id: 'side' },
        ]),
      ],
    } as unknown as RocketTree;
    useWorkspaceStore.setState({ tree });
    await s().saveRkt();
    expect(s().err).toContain(`${ja.part.railbutton}、${ja.part.fairing}`);
  });
});
