// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
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

  it('hides the emoji from assistive technology', () => {
    renderWithProviders(<AppHeader />);
    expect(screen.getByText('🚀').getAttribute('aria-hidden')).toBe('true');
  });
});
