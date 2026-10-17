// @vitest-environment jsdom
// cspell:ignore Schicht entfernen
import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { act, fireEvent, screen } from '@testing-library/react';
import { WindProfileDialog } from '../../../src/components/sim/WindProfileDialog';
import { renderWithProviders, seedSettings } from '../../testing/renderWithProviders';
import { launchPatchFor, type LaunchConditions, type WindLevel } from '../../../src/services/design/orkTree';

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
   * A row keeps its identity across a removal. Keyed on the index, removing the
   * first level would not remove its row: React would reuse the row for whatever
   * level slid into index 0 and drop the last row instead, so the input a user
   * was editing would suddenly hold a different level's numbers.
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
   * its levels on altitude and throws on the second one. Unflagged here it surfaces
   * half way into a run, in the kernel's own words (`Wind level already exists for
   * altitude: 0.0`), for something this editor let the user type.
   */
  it('flags a row repeating an earlier altitude, and says why', () => {
    renderWithProviders(<Host />);
    const second = screen.getByLabelText('Altitude 2') as HTMLInputElement;
    expect(second.getAttribute('aria-invalid')).toBeNull();

    fireEvent.focus(second);
    fireEvent.change(second, { target: { value: '0' } });

    expect(second.getAttribute('aria-invalid')).toBe('true');
    // The first row at that altitude is the one that gets in, so it stays clean.
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
   * An altitude is the level's identity to the kernel, not a quantity with a
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
   * `NumberInput` refuses a non-finite entry, but the unit conversion can
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
   * A new level lands 300 m above the highest one, not above the last row. The
   * list is not sorted, so on a 0/600/300 profile the last row's +300 would land
   * on 600 and collide with a level that is already there.
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

/** One gusty level: 5 m/s with a 0.75 m/s deviation, 15% turbulence. */
function GustyHost({ onLevels }: { onLevels?: (l: WindLevel[]) => void }) {
  const [launch, setLaunch] = useState<LaunchConditions>({
    windLevels: [{ altitudeM: 0, speed: 5, directionDeg: 90, stddev: 0.75 }],
  } as LaunchConditions);
  return (
    <WindProfileDialog
      launch={launch}
      onChange={(p) =>
        setLaunch((l) => {
          const next = { ...l, ...p };
          onLevels?.(next.windLevels ?? []);
          return next;
        })
      }
      onClose={() => {}}
    />
  );
}

/**
 * The speed box reports every keystroke, and the turbulence follows the speed as
 * a fraction. Typing "0.5" passes through "0", where a ratio carried from the
 * previous keystroke would become 0 and stay there.
 */
describe('WindProfileDialog speed edits keep the turbulence', () => {
  it('keeps 15% when "0.5" is typed over a 5 m/s, 15% layer', () => {
    let last: WindLevel[] = [];
    renderWithProviders(<GustyHost onLevels={(l) => (last = l)} />);
    const speed = screen.getByLabelText('Speed 1') as HTMLInputElement;
    fireEvent.focus(speed);
    for (const text of ['', '0', '0.', '0.5']) fireEvent.change(speed, { target: { value: text } });
    fireEvent.blur(speed);

    expect((screen.getByLabelText('Turbulence 1') as HTMLInputElement).value).toBe('15');
    expect(last[0]!.speed).toBe(0.5);
    expect(last[0]!.stddev).toBeCloseTo(0.075, 9);
  });

  it('writes nothing for a cleared speed box', () => {
    const seen: WindLevel[][] = [];
    renderWithProviders(<GustyHost onLevels={(l) => seen.push(l)} />);
    const speed = screen.getByLabelText('Speed 1') as HTMLInputElement;
    fireEvent.focus(speed);
    fireEvent.change(speed, { target: { value: '' } });

    expect(seen).toEqual([]);
  });

  it('carries the turbulence from the new speed once the edit is committed', () => {
    let last: WindLevel[] = [];
    renderWithProviders(<GustyHost onLevels={(l) => (last = l)} />);
    const speed = screen.getByLabelText('Speed 1') as HTMLInputElement;
    fireEvent.focus(speed);
    fireEvent.change(speed, { target: { value: '10' } });
    fireEvent.blur(speed);
    // A second visit starts from 10 m/s and 1.5 m/s, still 15%.
    fireEvent.focus(speed);
    fireEvent.change(speed, { target: { value: '2' } });
    fireEvent.blur(speed);

    expect(last[0]!.stddev).toBeCloseTo(0.3, 9);
  });
});

describe('WindProfileDialog direction header', () => {
  it('names the angle unit the cells are shown in', () => {
    seedSettings({ units: { angle: 'rad' } });
    renderWithProviders(<Host />);
    expect(screen.getByText(/\(rad\)$/)).toBeTruthy();
    expect(screen.queryByText(/\(°\)$/)).toBeNull();
    localStorage.clear();
  });
});

describe('WindProfileDialog row labels', () => {
  /** A language that names the level after the field, not with a bare number. */
  it('builds each row label from one key, so the order follows the language', async () => {
    const i18n = (await import('../../../src/i18n')).default;
    await i18n.changeLanguage('de');
    try {
      renderWithProviders(<Host />);
      const field = i18n.t('windProfile.altitude');
      expect(screen.getByLabelText(`${field}, Schicht 1`)).toBeTruthy();
      expect(screen.getByLabelText('Schicht 2 entfernen')).toBeTruthy();
    } finally {
      await i18n.changeLanguage('en');
    }
  });
});

/**
 * The safety codes' wind ceiling is the pad's, so only the ground layer's
 * deviation box carries it, as only its speed box does. Aloft, the turbulence
 * box beside it sets up to its full percentage of the level's speed, and the
 * deviation box has to hold what that writes.
 */
describe('WindProfileDialog deviation ceiling', () => {
  const FAST: WindLevel[] = [
    { altitudeM: 0, speed: 4, directionDeg: 90, stddev: 0 },
    { altitudeM: 1000, speed: 25, directionDeg: 90, stddev: 0 },
    { altitudeM: 3000, speed: 40, directionDeg: 90, stddev: 0 },
  ];
  const seen: WindLevel[][] = [];
  function FastHost() {
    const [launch, setLaunch] = useState<LaunchConditions>({ windLevels: FAST } as LaunchConditions);
    return (
      <WindProfileDialog
        launch={launch}
        onChange={(p) => {
          const patch = launchPatchFor(p, launch, 'x');
          if (patch.windLevels) seen.push(patch.windLevels);
          setLaunch((l) => ({ ...l, ...patch }));
        }}
        onClose={() => {}}
      />
    );
  }
  const last = () => seen[seen.length - 1]!;

  it('keeps an upper level deviation the turbulence box writes, at every upper level', () => {
    renderWithProviders(<FastHost />);
    for (const n of [2, 3]) {
      const turbulence = screen.getByLabelText(`Turbulence ${n}`) as HTMLInputElement;
      fireEvent.focus(turbulence);
      fireEvent.change(turbulence, { target: { value: '100' } });
      fireEvent.blur(turbulence);
      const level = FAST[n - 1]!;
      // 100% of the level's own speed.
      expect(last()[n - 1]!.stddev).toBeCloseTo(level.speed, 9);

      const deviation = screen.getByLabelText(`Deviation ${n}`) as HTMLInputElement;
      fireEvent.focus(deviation);
      fireEvent.change(deviation, { target: { value: String(level.speed * 0.9) } });
      fireEvent.blur(deviation);
      expect(last()[n - 1]!.stddev).toBeCloseTo(level.speed * 0.9, 9);
    }
  });

  it('still caps the ground layer', () => {
    renderWithProviders(<FastHost />);
    const deviation = screen.getByLabelText('Deviation 1') as HTMLInputElement;
    expect(deviation.getAttribute('max')).not.toBeNull();
    for (const n of [2, 3]) expect(screen.getByLabelText(`Deviation ${n}`).getAttribute('max')).toBeNull();
  });
});

/**
 * Reading the CSV resolves after the fact, and the import writes to whatever
 * simulations are the current edit targets. Closing the dialog before the read
 * finishes must not let it land on them.
 */
describe('WindProfileDialog CSV import', () => {
  it('drops a file whose read finishes after the dialog was closed', async () => {
    const csv = ['altitude,speed,direction,stddev', '0,4,90,0', '500,8,110,1'].join('\n');
    const bytes = new TextEncoder().encode(csv);
    let finish!: (b: ArrayBuffer) => void;
    const file = new File([bytes], 'wind.csv', { type: 'text/csv' });
    file.arrayBuffer = () => new Promise<ArrayBuffer>((r) => (finish = r));
    const onChange = vi.fn();
    const { unmount } = renderWithProviders(
      <WindProfileDialog launch={{ windLevels: LEVELS } as LaunchConditions} onChange={onChange} onClose={() => {}} />,
    );
    fireEvent.change(document.body.querySelector('input[type="file"]')!, { target: { files: [file] } });
    unmount();
    await act(async () => {
      finish(bytes.buffer.slice(0) as ArrayBuffer);
    });
    expect(onChange).not.toHaveBeenCalled();
  });
});
