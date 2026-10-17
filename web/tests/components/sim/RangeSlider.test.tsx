// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { RangeSlider } from '../../../src/components/sim/RangeSlider';
import i18n from '../../../src/i18n';

/** Each thumb is named through one key, so the word order follows the language. */
describe('RangeSlider thumb names', () => {
  const render = () =>
    renderWithProviders(<RangeSlider count={5} low={0} high={4} onChange={() => {}} label="Diameter" />);

  it('names the two thumbs in English', () => {
    render();
    expect(screen.getByLabelText('Diameter min')).toBeTruthy();
    expect(screen.getByLabelText('Diameter max')).toBeTruthy();
  });

  it('names them in the UI language', async () => {
    await i18n.changeLanguage('ja');
    try {
      render();
      expect(screen.getByLabelText('Diameter（最小）')).toBeTruthy();
      expect(screen.getByLabelText('Diameter（最大）')).toBeTruthy();
    } finally {
      await i18n.changeLanguage('en');
    }
  });
});

/** A screen reader hears the stop's label, not the thumb's index among the stops. */
describe('RangeSlider thumb values', () => {
  const stops = ['6 mm', '10.5 mm', '13 mm', '18 mm', '24 mm'];

  it('announces each thumb as the label of its stop, at every position', () => {
    for (let lo = 0; lo < stops.length; lo++) {
      for (let hi = lo; hi < stops.length; hi++) {
        const { unmount } = renderWithProviders(
          <RangeSlider count={stops.length} low={lo} high={hi} onChange={() => {}} label="Diameter" stops={stops} />,
        );
        expect(screen.getByLabelText('Diameter min').getAttribute('aria-valuetext')).toBe(stops[lo]);
        expect(screen.getByLabelText('Diameter max').getAttribute('aria-valuetext')).toBe(stops[hi]);
        unmount();
      }
    }
  });
});
