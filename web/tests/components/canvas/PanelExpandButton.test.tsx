// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { PanelExpandButton } from '../../../src/components/canvas/PanelExpandButton';
import { renderWithProviders } from '../../testing/renderWithProviders';

/**
 * The expand button's name says what a press does, so it carries no
 * aria-pressed: "Show all panels, pressed" would contradict itself.
 */
describe('PanelExpandButton', () => {
  it.each([
    [false, 'Show only this panel'],
    [true, 'Show all panels'],
  ])('expanded=%s is named "%s" and is not a pressed toggle', (expanded, name) => {
    renderWithProviders(<PanelExpandButton expanded={expanded} onClick={() => {}} />);
    expect(screen.getByRole('button', { name }).hasAttribute('aria-pressed')).toBe(false);
  });
});
