// @vitest-environment jsdom
// cspell:ignore Oberstufe
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { StageColorDialog } from '../../../src/components/canvas/StageColorDialog';
import i18n from '../../../src/i18n';

/**
 * Each swatch is named for its stage and role through one key, so a language
 * that puts the role first ("Bahn für Oberstufe") reads right.
 */
describe('StageColorDialog swatch names', () => {
  const render = () =>
    renderWithProviders(
      <StageColorDialog
        names={['Oberstufe']}
        colors={new Map()}
        groundColors={new Map()}
        pinColors={new Map()}
        onApply={() => {}}
        onCancel={() => {}}
      />,
    );

  it('orders the stage and role as the language does', async () => {
    await i18n.changeLanguage('de');
    try {
      render();
      expect(screen.getByLabelText(`${i18n.t('pathExport.colorRolePath')} für Oberstufe`)).toBeTruthy();
    } finally {
      await i18n.changeLanguage('en');
    }
  });

  it('reads stage then role in English', () => {
    render();
    expect(screen.getByLabelText(`Oberstufe ${i18n.t('pathExport.colorRolePath')}`)).toBeTruthy();
  });
});
