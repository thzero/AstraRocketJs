// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { AppHeader } from '../../../src/components/layout/AppHeader';
import { renderWithProviders } from '../../testing/renderWithProviders';

/** The header's rocket mark is decoration: the app name beside it is the name. */
describe('AppHeader mark', () => {
  beforeEach(() => {
    window.matchMedia = ((query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    })) as unknown as typeof window.matchMedia;
  });

  it('hides the mark from assistive technology', () => {
    renderWithProviders(<AppHeader />);
    const mark = document.querySelector('header img[src$="favicon.svg"]');
    expect(mark?.getAttribute('alt')).toBe('');
    expect(mark?.getAttribute('aria-hidden')).toBe('true');
  });

  it('opens About, as the version does', async () => {
    renderWithProviders(<AppHeader />);
    fireEvent.click(screen.getByRole('button', { name: 'About' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(document.body.textContent).toContain('A lightweight web UI for the OpenRocket engine');
  });
});
