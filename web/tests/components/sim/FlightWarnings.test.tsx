// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { FlightWarnings } from '../../../src/components/sim/FlightWarnings';
import { renderWithProviders } from '../../testing/renderWithProviders';
import type { FlightResult } from '../../../src/engine/api';

/** A HIGH kernel warning says so in words; the danger color is not the only difference. */
describe('FlightWarnings priority', () => {
  const sim = (priority: string) =>
    ({ warnings: [{ key: 'w', message: 'Something happened', priority }] }) as unknown as FlightResult;

  it('names a HIGH warning as serious', () => {
    renderWithProviders(<FlightWarnings sim={sim('HIGH')} />);
    expect(screen.getByRole('listitem').textContent).toMatch(/^⚠Serious: /);
  });

  it('adds nothing to a NORMAL one', () => {
    renderWithProviders(<FlightWarnings sim={sim('NORMAL')} />);
    expect(screen.getByRole('listitem').textContent).not.toContain('Serious');
  });
});
