// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, screen } from '@testing-library/react';
import { WindProfileDialog } from './WindProfileDialog';
import { renderWithProviders } from '../../testing/renderWithProviders';
import type { LaunchConditions, WindLevel } from '../../services/orkTree';

const LEVELS: WindLevel[] = [
  { altitudeM: 0, speed: 2, directionDeg: 90, stddev: 0 },
  { altitudeM: 300, speed: 4, directionDeg: 90, stddev: 0 },
  { altitudeM: 600, speed: 6, directionDeg: 90, stddev: 0 },
];

/** The dialog over a live profile, the way LaunchPanel wires it. */
function Host() {
  const [launch, setLaunch] = useState<LaunchConditions>({ windLevels: LEVELS } as LaunchConditions);
  return <WindProfileDialog launch={launch} onChange={(p) => setLaunch((l) => ({ ...l, ...p }))} onClose={() => {}} />;
}

describe('WindProfileDialog rows', () => {
  /**
   * Rows were keyed on their index. Removing the first level therefore did
   * not remove its row: React reused the row for whatever level slid into
   * index 0 and dropped the LAST row instead, so the input a user was editing
   * suddenly held a different level's numbers and the field under the cursor
   * changed meaning. A row now keeps its identity across a removal.
   */
  it('keeps each remaining row on its own level when an earlier one is removed', () => {
    renderWithProviders(<Host />);
    const secondSpeed = screen.getByLabelText('Speed 2') as HTMLInputElement;
    const thirdSpeed = screen.getByLabelText('Speed 3') as HTMLInputElement;
    expect(secondSpeed.value).toBe('4');

    fireEvent.click(screen.getByLabelText('Remove level 1'));

    // The same DOM elements, now labeled 1 and 2, still carrying 4 and 6.
    expect(document.body.contains(secondSpeed)).toBe(true);
    expect(document.body.contains(thirdSpeed)).toBe(true);
    expect(secondSpeed.getAttribute('aria-label')).toBe('Speed 1');
    expect(secondSpeed.value).toBe('4');
    expect(thirdSpeed.value).toBe('6');
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    renderWithProviders(
      <WindProfileDialog launch={{ windLevels: LEVELS } as LaunchConditions} onChange={() => {}} onClose={onClose} />,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
