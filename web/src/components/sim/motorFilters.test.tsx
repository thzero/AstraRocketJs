// @vitest-environment jsdom
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../testing/renderWithProviders';
import type { CatalogMotor } from '../../services/motorDb';

/**
 * The picker's narrowing filters beyond code, maker and class: total impulse,
 * whether the motor comes plugged, and whether it goes in the mount at all.
 *
 * Its own catalog rather than the one MotorDialog.test.tsx uses, because these
 * need rows that differ in the fields the other file has no reason to carry -
 * bore, length and impulse spread across four motors.
 */

// No bundled curve: these rows exist to be filtered, not to be flown, and the
// picker only needs one when a motor is actually selected.
const base = { manufacturer: 'Test', burn: 1, mass: 20 };
const CATALOG: CatalogMotor[] = [
  // Fits an 18 mm mount.
  { ...base, designation: 'C6', class: 'C', diameter: 18, length: 70, impulse: 8.8, delays: '0,3,5,7' },
  // Right bore, too long for the tube (and its overhang).
  { ...base, designation: 'D21', class: 'D', diameter: 18, length: 120, impulse: 20, delays: 'P' },
  // Too fat.
  { ...base, designation: 'D12', class: 'D', diameter: 24, length: 70, impulse: 16.8, delays: '4,6,P' },
  { ...base, designation: 'E20', class: 'E', diameter: 29, length: 100, impulse: 40, delays: '6,8' },
];

vi.mock('../../services/motorDb', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  loadCatalog: () => Promise.resolve(CATALOG),
}));
vi.mock('../../services/thrustcurve', () => ({ fetchMotorSpec: vi.fn() }));

const { MotorDialog } = await import('./MotorDialog');

/** An 18 mm tube 70 mm long, with OpenRocket's default 6.35 mm of overhang. */
const MOUNT = { bore: 18, maxLength: 76.35 };

const open = async (mount: { bore: number; maxLength?: number } | null) => {
  const r = renderWithProviders(
    <MotorDialog onClose={() => {}} onSelect={() => {}} onError={() => {}} mount={mount} />,
  );
  await waitFor(() => expect(screen.queryByText('Loading motor catalog…')).toBeNull());
  return r;
};

/** Which motors the list is showing, in order. */
const listed = () => CATALOG.map((m) => m.designation).filter((d) => screen.queryByText(d) !== null);

// The picker REMEMBERS the diameter range, so a test that drags the slider
// would otherwise hand its ceiling to every test after it in this file.
beforeEach(() => localStorage.clear());

const fitsBox = () => screen.getByRole('checkbox', { name: /Fits the mount/ });
const impulseMin = () => screen.getByRole('spinbutton', { name: 'Total impulse min' });
const impulseMax = () => screen.getByRole('spinbutton', { name: 'Total impulse max' });
const pluggedBox = () => screen.getByRole('checkbox', { name: 'Plugged' });

describe('the motor picker filters by what fits the mount', () => {
  it('starts on, and keeps only the motors that go in', async () => {
    await open(MOUNT);
    // D12 and E20 are too fat; D21 has the right bore and is too long for the
    // tube even counting the overhang.
    expect(listed()).toEqual(['C6']);
    expect((fitsBox() as HTMLInputElement).checked).toBe(true);
  });

  it('names the bore it is measuring against', async () => {
    // The one number the user cannot see from inside this dialog. Formatted the
    // same way as the diameter readout right above it, decimal and all.
    await open(MOUNT);
    expect(fitsBox().closest('label')!.textContent).toBe('Fits the mount (18.0 mm)');
  });

  it('gives the whole catalog back when it is turned off', async () => {
    await open(MOUNT);
    fireEvent.click(fitsBox());
    expect(listed()).toEqual(['C6', 'D21', 'D12', 'E20']);
  });

  it('is not offered at all where there is no mount to fit', async () => {
    // The dashboard's case, and a mount whose geometry cannot be read: a
    // checkbox with nothing to measure against would be a control that lies.
    await open(null);
    expect(screen.queryByRole('checkbox', { name: /Fits the mount/ })).toBeNull();
    expect(listed()).toEqual(['C6', 'D21', 'D12', 'E20']);
  });

  it('pulls the diameter ceiling down to the mount, and gives it back', async () => {
    /*
     * The restriction is a thing you can SEE. Two earlier designs hid it: one
     * seeded the ceiling from the mount on first open and saved it as if the
     * user had chosen it, the other capped the slider's TRACK while the box was
     * ticked - and since the readout says "Any" for a thumb at the top of its
     * track, that made an 18 mm mount read "Any-Any" ticked and "Any-18 mm"
     * clear, so the box appeared to do the opposite of what it says.
     */
    await open(MOUNT);
    const max = () => screen.getByRole('slider', { name: 'Diameter max' }) as HTMLInputElement;
    const readout = () => max().closest('div')!.parentElement!.textContent;
    // STD_DIAMS is [6, 13, 18, …], so an 18 mm mount is stop 2.
    expect(max().value).toBe('2');
    expect(readout()).toContain('Any–18.0 mm');

    fireEvent.click(fitsBox());
    expect(max().value).toBe('9');
    expect(readout()).toContain('Any–Any');

    fireEvent.click(fitsBox());
    expect(max().value).toBe('2');
    expect(readout()).toContain('Any–18.0 mm');
  });

  it('marks every standard motor diameter on the track', async () => {
    // The ten positions are 6, 13, 18, 24, 29, 38, 54, 75, 98 and 150 mm, and
    // with nothing drawn the slider read as a continuous scale: there was no way
    // to aim at a size except to drag and read the number back.
    const { container } = await open(MOUNT);
    const ticks = [...container.querySelectorAll('span[title][aria-hidden]')];
    // Formatted by the app's own unit rules (three significant figures), the
    // same way the readout beside the slider does it.
    expect(ticks.map((el) => el.getAttribute('title'))).toEqual([
      '6.00 mm',
      '13.0 mm',
      '18.0 mm',
      '24.0 mm',
      '29.0 mm',
      '38.0 mm',
      '54.0 mm',
      '75.0 mm',
      '98.0 mm',
      '150 mm',
    ]);
    // Evenly spaced across the track, first to last.
    expect((ticks[0] as HTMLElement).style.left).toBe('0%');
    expect((ticks[9] as HTMLElement).style.left).toBe('100%');
    // Lit inside the selected range, plain outside it: the marks say which sizes
    // are in as well as where they are. The mount has capped this at 18 mm.
    expect(ticks[2]!.className).toContain('bg-sky-400/80');
    expect(ticks[3]!.className).toContain('bg-slate-600');
  });

  it('keeps the whole track, so the slider can still be dragged past the mount', async () => {
    // Capping the track was the other failed design: the thumb then sits at the
    // end of its run and the readout calls that "Any".
    await open(MOUNT);
    expect(screen.getByRole('slider', { name: 'Diameter max' }).getAttribute('max')).toBe('9');
  });

  it('clears itself when the ceiling is dragged above what the mount takes', async () => {
    // Asking for 29 mm motors in an 18 mm mount is asking to see past the
    // mount. Leaving the box ticked would leave a control that moved and
    // changed nothing.
    await open(MOUNT);
    fireEvent.change(screen.getByRole('slider', { name: 'Diameter max' }), { target: { value: '4' } });
    expect((fitsBox() as HTMLInputElement).checked).toBe(false);
    expect(listed()).toEqual(['C6', 'D21', 'D12', 'E20']);
  });

  it('does not widen a choice narrower than the mount', async () => {
    // Someone who asked for 13 mm and under did not ask for 18 mm by ticking a
    // box.
    await open(MOUNT);
    const max = () => screen.getByRole('slider', { name: 'Diameter max' }) as HTMLInputElement;
    fireEvent.change(max(), { target: { value: '1' } });
    expect((fitsBox() as HTMLInputElement).checked).toBe(true);
    fireEvent.click(fitsBox());
    fireEvent.click(fitsBox());
    expect(max().value).toBe('1');
  });

  it('says why the list is empty rather than showing a blank panel', async () => {
    await open(MOUNT);
    fireEvent.change(impulseMin(), { target: { value: '100' } });
    expect(listed()).toEqual([]);
    expect(screen.getByText('No matching motors.')).toBeTruthy();
    // The fit filter is the likeliest reason a list is short, so it is named.
    expect(screen.getByText(/Only motors that go in this mount/)).toBeTruthy();
  });
});

describe('the motor picker filters by whether a motor comes plugged', () => {
  it('keeps the ones the maker lists without an ejection charge', async () => {
    await open(null);
    fireEvent.click(pluggedBox());
    // D21 is plugged-only and D12 offers it alongside numeric delays; C6 and
    // E20 come with a charge.
    expect(listed()).toEqual(['D21', 'D12']);
  });

  it('is off to begin with, since most motors have a delay', async () => {
    await open(null);
    expect((pluggedBox() as HTMLInputElement).checked).toBe(false);
    expect(listed()).toEqual(['C6', 'D21', 'D12', 'E20']);
  });

  it('narrows alongside the other filters rather than replacing them', async () => {
    await open(MOUNT);
    // The mount already leaves only C6, which is not plugged.
    fireEvent.click(pluggedBox());
    expect(listed()).toEqual([]);
    fireEvent.click(fitsBox());
    expect(listed()).toEqual(['D21', 'D12']);
  });
});

describe('the picker stacks its filters in reading order', () => {
  it('puts impulse under the code and class, and above the diameter', async () => {
    const { container } = await open(MOUNT);
    const order = ['motorDlg.searchCode', 'Total impulse min', 'Diameter min', 'Plugged'];
    const positions = order.map((name) => {
      const el =
        name === 'motorDlg.searchCode'
          ? container.querySelector('input[placeholder]')!
          : screen.getByRole(name === 'Plugged' ? 'checkbox' : name.includes('Diameter') ? 'slider' : 'spinbutton', {
              name,
            });
      return [...container.querySelectorAll('*')].indexOf(el as Element);
    });
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});

describe('the motor picker filters by total impulse', () => {
  it('takes a floor, a ceiling, or both', async () => {
    await open(null);
    fireEvent.change(impulseMin(), { target: { value: '16' } });
    expect(listed()).toEqual(['D21', 'D12', 'E20']);

    fireEvent.change(impulseMax(), { target: { value: '20' } });
    expect(listed()).toEqual(['D21', 'D12']);

    fireEvent.change(impulseMin(), { target: { value: '' } });
    expect(listed()).toEqual(['C6', 'D21', 'D12']);
  });

  it('answers what the class chips cannot', async () => {
    // D21 and D12 are both class D. A class is a doubling bucket, so no chip
    // can separate 20 N·s from 16.8 N·s.
    await open(null);
    fireEvent.change(impulseMin(), { target: { value: '18' } });
    expect(listed()).toEqual(['D21', 'E20']);
  });
});
