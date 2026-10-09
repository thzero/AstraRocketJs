// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { TabBar } from '../../../src/components/layout/TabBar';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { useWorkspaceStore } from '../../../src/state/store';

/**
 * The phone's tab bar: each tab is named by its label alone (the emoji is
 * decoration), and the current tab is marked by more than its color.
 */
describe('TabBar', () => {
  it('names each tab by its label, without the emoji', () => {
    useWorkspaceStore.setState({ tab: 'design', designPane: 'stats' });
    renderWithProviders(<TabBar />);
    expect(screen.getByRole('button', { name: 'Rocket' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sketch' })).toBeTruthy();
  });

  it('marks the current tab with a bar and weight as well as color', () => {
    useWorkspaceStore.setState({ tab: 'design', designPane: 'sketch' });
    renderWithProviders(<TabBar />);
    const current = screen.getAllByRole('button', { name: 'Sketch' }).at(-1)!;
    const other = screen.getAllByRole('button', { name: 'Rocket' }).at(-1)!;
    expect(current.getAttribute('aria-current')).toBe('page');
    expect(current.className).toMatch(/\bfont-semibold\b/);
    expect(current.className).toMatch(/\bborder-accent-400\b/);
    expect(other.className).not.toMatch(/\bfont-semibold\b/);
    expect(other.className).toMatch(/\bborder-transparent\b/);
  });
});
