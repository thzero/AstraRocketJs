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
