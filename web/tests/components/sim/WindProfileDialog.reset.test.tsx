// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { useState } from 'react';
import { fireEvent, screen } from '@testing-library/react';
import { WindProfileDialog } from '../../../src/components/sim/WindProfileDialog';
import { renderWithProviders, seedSettings } from '../../testing/renderWithProviders';
import type { LaunchConditions, WindLevel } from '../../../src/services/design/orkTree';

/**
 * Reset levels leaves what desktop's does. `MultiLevelPinkNoiseWindModel.resetLevels`
 * (MultiLevelPinkNoiseWindModel.java:95-99) clears the levels and calls
 * `addInitialLevel` (:69-72), which adds one level at altitude 0 with the
 * preferences' average wind: its speed, direction and standard deviation.
 */
describe('resetting the wind profile', () => {
  it('leaves one level at the pad carrying the preferred average wind', () => {
    seedSettings({ launchDefaults: { windAverage: 3.5, windStdDev: 0.7, windDirectionDeg: 45 } });
    let latest: WindLevel[] | undefined;
    function Host() {
      const [launch, setLaunch] = useState<LaunchConditions>({
        windLevels: [
          { altitudeM: 0, speed: 2, directionDeg: 90, stddev: 0 },
          { altitudeM: 300, speed: 4, directionDeg: 90, stddev: 0 },
        ],
      } as LaunchConditions);
      latest = launch.windLevels;
      return (
        <WindProfileDialog launch={launch} onChange={(p) => setLaunch((l) => ({ ...l, ...p }))} onClose={() => {}} />
      );
    }
    renderWithProviders(<Host />);
    fireEvent.click(screen.getByRole('button', { name: 'Reset levels' }));
    expect(latest).toEqual([{ altitudeM: 0, speed: 3.5, directionDeg: 45, stddev: 0.7 }]);
  });
});
