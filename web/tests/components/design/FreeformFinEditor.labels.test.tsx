// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import i18n from '../../../src/i18n';
import { FreeformFinEditor } from '../../../src/components/design/FreeformFinEditor';
import { renderWithProviders } from '../../testing/renderWithProviders';

type Pt = [number, number];

/**
 * The point coordinate boxes are named through the locale, not by a fixed
 * letter. Sentinels stand in for the axis names, so a hard-coded "X" or "Y"
 * cannot pass.
 */
describe('the freeform point boxes', () => {
  it('take their axis names from the locale', () => {
    const own = { x: i18n.t('freeform.x'), y: i18n.t('freeform.y') };
    i18n.addResource('en', 'translation', 'freeform.x', 'Along');
    i18n.addResource('en', 'translation', 'freeform.y', 'Up');
    try {
      const points: Pt[] = [
        [0, 0],
        [0.02, 0.03],
        [0.06, 0],
      ];
      renderWithProviders(<FreeformFinEditor points={points} onChange={() => {}} />);
      fireEvent.focus(screen.getByLabelText('Outline point 2'));
      expect(screen.getByRole('spinbutton', { name: 'Along' })).toBeTruthy();
      expect(screen.getByRole('spinbutton', { name: 'Up' })).toBeTruthy();
      expect(screen.queryByRole('spinbutton', { name: 'X' })).toBeNull();
      expect(screen.queryByRole('spinbutton', { name: 'Y' })).toBeNull();
    } finally {
      i18n.addResource('en', 'translation', 'freeform.x', own.x);
      i18n.addResource('en', 'translation', 'freeform.y', own.y);
    }
  });
});
