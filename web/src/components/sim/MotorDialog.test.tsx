// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { fireEvent, screen, waitFor, act } from '@testing-library/react';
import { renderWithProviders } from '../../testing/renderWithProviders';
import type { CatalogMotor } from '../../services/motorDb';
import type { MotorSpec } from '../../engine/openRocketEngine';

const curve = {
  src: 'Certified · RASP',
  samples: [
    [0, 0],
    [0.5, 10],
    [1, 0],
  ] as [number, number][],
};
const X: CatalogMotor = {
  manufacturer: 'Test',
  designation: 'X',
  class: 'C',
  diameter: 18,
  impulse: 10,
  burn: 1,
  mass: 20,
  delays: '4,7,10',
  curves: [curve],
};
const Y: CatalogMotor = { ...X, designation: 'Y', delays: '3,5,8' };

const loadCatalog = vi.fn(() => Promise.resolve([X, Y]));
vi.mock('../../services/motorDb', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  loadCatalog: () => loadCatalog(),
}));
const fetchMotorSpec = vi.fn<(m: CatalogMotor, delay: number) => Promise<MotorSpec>>();
vi.mock('../../services/thrustcurve', () => ({ fetchMotorSpec: (m: CatalogMotor, d: number) => fetchMotorSpec(m, d) }));

const { MotorDialog } = await import('./MotorDialog');

/** X, seated on the mount with a 7 s delay: what the card opens the picker with. */
const seatedX: MotorSpec = {
  designation: 'X',
  manufacturer: 'Test',
  diameter: 0.018,
  length: 0.07,
  times: [0, 1],
  thrusts: [10, 0],
  masses: [0.02, 0.01],
  cgX: 0.035,
  ejectionDelay: 7,
  curveSrc: curve.src,
};

/** The picker wired the way MotorRow wires it: mounted only while open. */
function Host({ current, onSelect }: { current: MotorSpec | null; onSelect: (m: MotorSpec) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>open picker</button>
      {open && <MotorDialog onClose={() => setOpen(false)} onSelect={onSelect} onError={() => {}} current={current} />}
    </>
  );
}

// The row's name is its inline spans run together: "XTest10 N·s · 18 mm".
const row = (name: string) => screen.findByRole('button', { name: new RegExp(`^${name}\\s?Test`) });
const delayBox = () => screen.getByRole('spinbutton', { name: 'Delay' }) as HTMLInputElement;
const openPicker = () => fireEvent.click(screen.getByRole('button', { name: 'open picker' }));
const closePicker = () => fireEvent.click(screen.getByRole('button', { name: 'Close' }));

beforeEach(() => {
  loadCatalog.mockClear();
  fetchMotorSpec.mockReset();
  localStorage.clear();
});

describe('MotorDialog', () => {
  /**
   * The seated motor's delay was restored by an effect guarded by two refs
   * that only ran once per opening, and the "reset on selection" effect had a
   * matching skip-once ref. After a close and reopen the refs disagreed about
   * whose turn it was, so clicking a different motor kept the 7 s that had
   * been seeded for the first one.
   */
  it('does not leak the seated delay onto the next pick after a reopen', async () => {
    renderWithProviders(<Host current={seatedX} onSelect={() => {}} />);
    openPicker();
    await row('X');
    // Seeded from the seated motor: X highlighted, its 7 s delay restored.
    await waitFor(() => expect(delayBox().value).toBe('7'));
    expect((await row('X')).getAttribute('aria-pressed')).toBe('true');

    closePicker();
    openPicker();
    fireEvent.click(await row('Y'));
    // Y's own default (the middle of its 3,5,8 charges), not X's 7.
    expect(delayBox().value).toBe('5');
    expect(screen.getByRole('button', { name: '5', pressed: true })).toBeTruthy();
  });

  /**
   * fetchMotorSpec can take seconds over the network. A result landing after
   * the user had already canceled was applied to the mount anyway.
   */
  it('drops a pick that resolves after the dialog was closed', async () => {
    let resolve!: (m: MotorSpec) => void;
    fetchMotorSpec.mockReturnValue(new Promise<MotorSpec>((r) => (resolve = r)));
    const onSelect = vi.fn();
    renderWithProviders(<Host current={null} onSelect={onSelect} />);
    openPicker();
    fireEvent.click(await row('X'));
    fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    expect(fetchMotorSpec).toHaveBeenCalledTimes(1);

    closePicker();
    await act(async () => {
      resolve(seatedX);
    });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('applies a pick that resolves while the dialog is still open', async () => {
    fetchMotorSpec.mockResolvedValue(seatedX);
    const onSelect = vi.fn();
    renderWithProviders(<Host current={null} onSelect={onSelect} />);
    openPicker();
    fireEvent.click(await row('X'));
    fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(seatedX));
    // The dialog closed itself once the motor was applied.
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  /**
   * Rows were keyed on their list index, so the highlight had to be dropped
   * on every filter change or it would point at whichever motor moved into
   * that slot. Keyed on the motor's identity, it survives.
   */
  it('keeps the highlighted motor across a filter change', async () => {
    renderWithProviders(<Host current={null} onSelect={() => {}} />);
    openPicker();
    fireEvent.click(await row('X'));
    const search = screen.getByPlaceholderText(/Search by code/);
    fireEvent.change(search, { target: { value: 'Y' } });
    expect(screen.queryByRole('button', { name: /^X\s?Test/ })).toBeNull();
    fireEvent.change(search, { target: { value: '' } });
    expect((await row('X')).getAttribute('aria-pressed')).toBe('true');
  });

  /**
   * The flip side. While a filter hides the highlighted row there is nothing
   * on screen to confirm, so the detail pane and its Select button go with it:
   * the picker must not apply a motor the user cannot see (the seated C6 while
   * the list shows A8s). Clearing the filter brings both back.
   */
  it('offers no Select while the filter hides the highlighted motor', async () => {
    renderWithProviders(<Host current={null} onSelect={() => {}} />);
    openPicker();
    fireEvent.click(await row('X'));
    expect(screen.getByRole('button', { name: /^Select$/ })).toBeTruthy();
    const search = screen.getByPlaceholderText(/Search by code/);
    fireEvent.change(search, { target: { value: 'Y' } });
    expect(screen.queryByRole('button', { name: /^Select$/ })).toBeNull();
    fireEvent.change(search, { target: { value: '' } });
    expect(screen.getByRole('button', { name: /^Select$/ })).toBeTruthy();
  });
});
