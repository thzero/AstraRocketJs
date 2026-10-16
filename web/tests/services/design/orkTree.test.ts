import { afterEach, describe, expect, it } from 'vitest';
import i18n from '../../../src/i18n';
import { asStageNodes, defaultStageName } from '../../../src/services/design/orkTree';
import type { RocketTree } from '../../../src/engine/openRocketEngine';
import de from '../../../src/i18n/locales/de.json';

afterEach(async () => {
  await i18n.changeLanguage('en');
});

/**
 * A flat tree's implicit stage is named by the same rule as every other unnamed
 * stage a file is given: desktop writes its own translated default, so this does
 * too, in the language showing.
 */
describe('asStageNodes', () => {
  const flat = { name: 'x', components: [{ type: 'nosecone', id: 'n' }] } as unknown as RocketTree;

  it('names the implicit stage as defaultStageName names the first stage', async () => {
    expect(asStageNodes(flat)[0]!.name).toBe(defaultStageName(0));
    await i18n.changeLanguage('de');
    expect(asStageNodes(flat)[0]!.name).toBe(de.stageName.sustainer);
    expect(asStageNodes(flat)[0]!.name).toBe(defaultStageName(0));
  });

  it('passes a staged tree through untouched', () => {
    const staged = { name: 'x', components: [{ type: 'stage', id: 's', name: 'Mine' }] } as unknown as RocketTree;
    expect(asStageNodes(staged)).toBe(staged.components);
  });
});
