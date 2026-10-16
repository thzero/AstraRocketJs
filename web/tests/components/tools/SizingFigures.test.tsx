// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { SizingFigures } from '../../../src/components/tools/SizingFigures';
import { renderWithProviders } from '../../testing/renderWithProviders';

/** Each unit chip in the card names the figure it belongs to, so no two read the same. */
describe('SizingFigures unit chips', () => {
  it('gives every chip a distinct name', () => {
    renderWithProviders(<SizingFigures massKg={1} cd={0.8} rho={1.225} diameterM={0.6} />);
    const names = screen.getAllByRole('combobox', { name: / unit$/ }).map((b) => b.getAttribute('aria-label'));
    expect(names.length).toBeGreaterThanOrEqual(3);
    expect(new Set(names).size).toBe(names.length);
    expect(names.some((n) => n?.startsWith('This canopy'))).toBe(true);
    expect(names.some((n) => n?.startsWith('Main'))).toBe(true);
    expect(names.some((n) => n?.startsWith('Drogue'))).toBe(true);
  });
});

/** The rate reads green inside the main or drogue band and amber anywhere else. */
describe('SizingFigures rate tone', () => {
  const FT_S = 0.3048;
  const toneAt = (rateFtS: number) => {
    renderWithProviders(<SizingFigures massKg={1} cd={0.8} rho={1.225} diameterM={0.6} rateMs={rateFtS * FT_S} />);
    const verdict = screen.getByText(/^\(.*\)$/);
    return verdict.previousElementSibling?.previousElementSibling?.className ?? '';
  };

  it('is amber between the bands', () => {
    expect(toneAt(35)).toContain('text-warn-400');
  });

  it('is green inside the main band', () => {
    expect(toneAt(18)).toContain('text-ok-400');
  });
});
