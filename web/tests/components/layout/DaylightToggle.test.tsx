// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders, seedSettings } from '../../testing/renderWithProviders';
import { DaylightToggle } from '../../../src/components/layout/DaylightToggle';
import { loadSettings } from '../../../src/services/storage/settings';

/** One tap into daylight and one back to the theme the reader had. */
describe('DaylightToggle', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  const button = () => screen.getByRole('button', { name: 'Daylight (high contrast)' });

  it('switches to daylight and back to the theme it left', () => {
    seedSettings({ theme: 'light' });
    renderWithProviders(<DaylightToggle />);
    expect(button().getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(button());
    expect(button().getAttribute('aria-pressed')).toBe('true');
    expect(document.documentElement.dataset.theme).toBe('daylight');
    expect(loadSettings().theme).toBe('daylight');

    fireEvent.click(button());
    expect(button().getAttribute('aria-pressed')).toBe('false');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(loadSettings().theme).toBe('light');
  });

  it('shows pressed when daylight was chosen in Settings, and goes back to dark', () => {
    seedSettings({ theme: 'daylight' });
    renderWithProviders(<DaylightToggle />);
    expect(button().getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(button());
    expect(loadSettings().theme).toBe('dark');
  });
});
