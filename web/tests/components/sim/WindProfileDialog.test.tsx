// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, screen } from '@testing-library/react';
import { WindProfileDialog } from '../../../src/components/sim/WindProfileDialog';
import { renderWithProviders, seedSettings } from '../../testing/renderWithProviders';
import type { LaunchConditions, WindLevel } from '../../../src/services/orkTree';

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

  /**
   * Two levels at one altitude is not a profile the kernel will build: it keys
   * its levels on altitude and throws on the second one. That used to surface
   * half way into a run, in the kernel's own words
   * (`Wind level already exists for altitude: 0.0`), for something this editor
   * let the user type.
   */
  it('flags a row repeating an earlier altitude, and says why', () => {
    renderWithProviders(<Host />);
    const second = screen.getByLabelText('Altitude 2') as HTMLInputElement;
    expect(second.getAttribute('aria-invalid')).toBeNull();

    fireEvent.focus(second);
    fireEvent.change(second, { target: { value: '0' } });

    expect(second.getAttribute('aria-invalid')).toBe('true');
    // The FIRST row at that altitude is the one that gets in, so it stays clean.
    expect((screen.getByLabelText('Altitude 1') as HTMLInputElement).getAttribute('aria-invalid')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('Two levels share an altitude');
  });

  it('clears the flag when the row moves off the collision', () => {
    renderWithProviders(<Host />);
    const second = screen.getByLabelText('Altitude 2') as HTMLInputElement;
    fireEvent.focus(second);
    fireEvent.change(second, { target: { value: '0' } });
    fireEvent.change(second, { target: { value: '450' } });

    expect(second.getAttribute('aria-invalid')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  /**
   * An altitude is the level's IDENTITY to the kernel, not a quantity with a
   * harmless zero. Clearing the box on the way to retyping it must not move the
   * layer down onto the pad, where it would displace the surface wind.
   */
  it('writes nothing when an altitude box is emptied', () => {
    renderWithProviders(<Host />);
    const second = screen.getByLabelText('Altitude 2') as HTMLInputElement;
    fireEvent.focus(second);
    fireEvent.change(second, { target: { value: '' } });
    fireEvent.blur(second);

    // Still the level it was, not a second level at 0 m.
    expect(second.value).toBe('300');
  });

  /**
   * `NumberInput` refuses a non-finite ENTRY, but the unit conversion can
   * overflow on its own: the box is in display units and the level is in SI.
   */
  it('writes nothing when the unit conversion overflows', () => {
    // Kilometers, which is what makes this possible: in meters (the default)
    // the conversion is a multiply by one.
    seedSettings({ units: { distance: 'km' } });
    const onChange = vi.fn();
    renderWithProviders(
      <WindProfileDialog launch={{ windLevels: LEVELS } as LaunchConditions} onChange={onChange} onClose={() => {}} />,
    );
    const alt = screen.getByLabelText('Altitude 2') as HTMLInputElement;
    fireEvent.focus(alt);
    fireEvent.change(alt, { target: { value: '1e306' } });

    expect(onChange).not.toHaveBeenCalled();
  });

  /**
   * A new level lands 300 m above the HIGHEST one, not above the last ROW. The
   * list is not sorted, so on a 0/600/300 profile the last row's +300 landed on
   * 600 and collided with a level that was already there.
   */
  it('adds a level that cannot collide with an existing one', () => {
    const onChange = vi.fn();
    renderWithProviders(
      <WindProfileDialog
        launch={
          {
            windLevels: [
              { altitudeM: 0, speed: 2, directionDeg: 90, stddev: 0 },
              { altitudeM: 600, speed: 6, directionDeg: 90, stddev: 0 },
              { altitudeM: 300, speed: 4, directionDeg: 90, stddev: 0 },
            ],
          } as LaunchConditions
        }
        onChange={onChange}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByText('Add new level'));

    const levels = (onChange.mock.calls.at(-1)![0] as { windLevels: WindLevel[] }).windLevels;
    expect(levels.at(-1)!.altitudeM).toBe(900);
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
