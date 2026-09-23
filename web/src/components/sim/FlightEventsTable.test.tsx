// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { FlightEventsTable } from './FlightEventsTable';
import { renderWithProviders } from '../../testing/renderWithProviders';
import type { FlightResult, FlightSeries } from '../../engine/openRocketEngine';

/**
 * The timeline as it is actually read. The row join is proved in
 * services/flightEvents.test.ts; what this covers is what that join is FOR —
 * that an event's own numbers land on its own row, that the extras a type is
 * read for appear only on that type, and that a stage is named only when there
 * is more than one.
 */

function series(over: Partial<FlightSeries> = {}): FlightSeries {
  return {
    time: [0, 1, 2, 3],
    altitude: [0, 100, 200, 300],
    velocity: [0, 10, 20, 30],
    acceleration: [0, 0, 0, 0],
    mass: [1, 1, 1, 1],
    thrust: [0, 0, 0, 0],
    drag: [0, 0, 0, 0],
    mach: [0, 0.1, 0.2, 0.3],
    stability: [2, 2, 2, 2],
    cpLocation: [0.5, 0.5, 0.5, 0.5],
    cgLocation: [0.4, 0.4, 0.4, 0.4],
    aoa: [0, 0, 0, 0],
    ...over,
  };
}

const result = (over: Partial<FlightResult>): FlightResult =>
  ({ summary: {}, events: [], series: series(), ...over }) as FlightResult;

/**
 * The <tr> an event's name sits in, so a value is asserted on ITS row.
 *
 * Matched on text rather than on the accessible name: dom-accessibility-api
 * trims each node's text before joining, so the spaces this table really does
 * render between an event, its source and its stage are absent from the
 * computed name and present in what a user sees and copies.
 */
function rowFor(name: string): HTMLElement {
  const heads = screen.getAllByRole('rowheader');
  const head = heads.find((h) => h.textContent?.replace(/\s+/g, ' ').trim() === name);
  if (!head) throw new Error(`no "${name}" row among ${JSON.stringify(heads.map((h) => h.textContent))}`);
  return head.closest('tr')!;
}

describe('FlightEventsTable', () => {
  it('renders nothing before a run, and nothing for a flight with no events', () => {
    expect(renderWithProviders(<FlightEventsTable sim={null} />).container.innerHTML).toBe('');
    expect(renderWithProviders(<FlightEventsTable sim={result({})} />).container.innerHTML).toBe('');
  });

  it('puts each event on its own row with the state at that instant', () => {
    renderWithProviders(<FlightEventsTable sim={result({ events: [{ type: 'APOGEE', time: 2 }] })} />);
    const cells = within(rowFor('Apogee')).getAllByRole('cell');
    expect(cells.map((c) => c.textContent)).toEqual(['2.00', '200', '20.0']);
  });

  it('names the component that raised it, so a drogue is told from a main', () => {
    renderWithProviders(
      <FlightEventsTable
        sim={result({
          events: [
            { type: 'RECOVERY_DEVICE_DEPLOYMENT', time: 2, source: 'Drogue' },
            { type: 'RECOVERY_DEVICE_DEPLOYMENT', time: 3, source: 'Main' },
          ],
        })}
      />,
    );
    // One phrase when copied out, not "Recovery deploymentDrogue".
    expect(rowFor('Recovery deployment Drogue')).toBeTruthy();
    expect(rowFor('Recovery deployment Main')).toBeTruthy();
  });

  it('shows the rail-departure extras on that row only', () => {
    renderWithProviders(
      <FlightEventsTable
        sim={result({
          events: [
            { type: 'LAUNCHROD', time: 1 },
            { type: 'APOGEE', time: 2 },
          ],
          series: series({ Twr: [0, 12, 8, 0], stability: [1.8, 1.8, 1.8, 1.8] }),
        })}
      />,
    );
    // Stability, thrust-to-weight and angle of attack: the four numbers that
    // say whether it left the rail flying.
    expect(screen.getByText('1.80 cal · TWR 12.0 · Angle of attack 0.0°')).toBeTruthy();
    // Apogee is read for none of them, so it carries no extras line.
    expect(screen.queryByText(/TWR/)).toBe(screen.getByText(/1\.80 cal/));
  });

  it('derives a Max-Q row the kernel never recorded, with its pressure and Mach', () => {
    renderWithProviders(
      <FlightEventsTable
        sim={result({
          events: [{ type: 'APOGEE', time: 3 }],
          series: series({ ρ: [1.2, 1.2, 0.6, 0.1], Vs: [340, 340, 340, 340] }),
        })}
      />,
    );
    // 0.5 * 0.6 * 68^2 = 1387.2 Pa, shown in the metric default of hPa.
    expect(within(rowFor('Max-Q')).getAllByRole('cell')[0]!.textContent).toBe('2.00');
    expect(screen.getByText('13.9 hPa · Mach 0.20')).toBeTruthy();
  });

  it('has no Max-Q row when the run recorded no air density', () => {
    renderWithProviders(<FlightEventsTable sim={result({ events: [{ type: 'APOGEE', time: 2 }] })} />);
    expect(screen.queryByRole('rowheader', { name: /Max-Q/ })).toBeNull();
  });

  it('names the stage on every row once a flight has separated', () => {
    renderWithProviders(
      <FlightEventsTable
        sim={result({
          branches: [
            { name: 'Sustainer', events: [{ type: 'APOGEE', time: 2 }], series: series() },
            { name: 'Booster', events: [{ type: 'GROUND_HIT', time: 1 }], series: series() },
          ],
        })}
      />,
    );
    // Earliest first, so the booster's landing reads above the sustainer's
    // apogee - they really did happen in that order.
    const names = screen.getAllByRole('rowheader').map((h) => h.textContent?.replace(/\s+/g, ' ').trim());
    expect(names).toEqual(['Landing Booster', 'Apogee Sustainer']);
  });

  it('leaves a single-stage flight unlabeled, having no stage worth naming', () => {
    renderWithProviders(<FlightEventsTable sim={result({ events: [{ type: 'APOGEE', time: 2 }] })} />);
    expect(screen.getByRole('rowheader').textContent?.trim()).toBe('Apogee');
  });

  it('offers the unit once per column rather than once per cell', () => {
    renderWithProviders(
      <FlightEventsTable
        sim={result({
          events: [
            { type: 'LIFTOFF', time: 0 },
            { type: 'APOGEE', time: 2 },
          ],
        })}
      />,
    );
    expect(screen.getAllByLabelText(/Altitude/).length).toBe(1);
  });
});
