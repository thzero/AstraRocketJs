// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';

const fetchSurfaceWind = vi.hoisted(() => vi.fn());
vi.mock('../../../src/services/tools/surfaceWind', async (orig) => ({
  ...(await orig<typeof import('../../../src/services/tools/surfaceWind')>()),
  fetchSurfaceWind,
}));

import { forgetOffTheRail, OffTheRail } from '../../../src/components/tools/OffTheRail';
import { renderWithProviders } from '../../testing/renderWithProviders';

beforeEach(() => {
  forgetOffTheRail();
  fetchSurfaceWind.mockReset();
});

/** A failed wind fetch is announced, not only drawn in red. */
describe('OffTheRail wind fetch', () => {
  it('raises the failure as an alert', async () => {
    fetchSurfaceWind.mockRejectedValue(new Error('forecast service down'));
    renderWithProviders(<OffTheRail />);
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Get the forecast wind' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});
