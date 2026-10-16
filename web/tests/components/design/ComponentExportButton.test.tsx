// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { ComponentExportButton } from '../../../src/components/design/ComponentExportButton';
import { renderWithProviders } from '../../testing/renderWithProviders';
import type { ComponentNode } from '../../../src/engine/openRocketEngine';

/** The per-part export menu follows the ARIA menu keyboard model its role promises. */
describe('ComponentExportButton menu keys', () => {
  const fin = { type: 'trapezoidfinset', id: 'f1' } as unknown as ComponentNode;

  it('opens onto the first format and walks the rest with the arrows', () => {
    renderWithProviders(<ComponentExportButton node={fin} />);
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    const items = screen.getAllByRole('menuitem');
    expect(items.length).toBeGreaterThan(1);
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
  });
});
