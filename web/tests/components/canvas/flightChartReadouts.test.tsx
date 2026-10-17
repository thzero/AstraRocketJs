// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
import { ChartCard } from '../../../src/components/canvas/AeroCharts';
import { FlightChart, type ChartFlight } from '../../../src/components/canvas/FlightChart';
import { FlightChartPanel } from '../../../src/components/canvas/FlightChartPanel';
import { FlightXYPanel } from '../../../src/components/canvas/FlightXYPanel';
import { SERIES, type Branch } from '../../../src/components/canvas/flightChartTraces';
import { renderWithProviders, seedSettings } from '../../testing/renderWithProviders';
import type { FlightSeries } from '../../../src/engine/openRocketEngine';
import { NO_VALUE } from '../../../src/i18n/noValue';

/**
 * What the flight chart's readouts say: the header and the live region agree,
 * a stage reports a value only inside its own flight, the zoom buttons say when
 * they can do nothing, and Escape is spent only when it dropped a crosshair.
 */
afterEach(() => localStorage.clear());

const flight = {
  id: 'sim-1',
  name: 'Simulation 1',
  result: {
    summary: { flightTime: 4 },
    events: [],
    series: {
      time: [0, 1, 2, 3, 4],
      altitude: [0, 100, 150, 100, 0],
      velocity: [0, 80, 0, -30, -5],
      acceleration: [50, 10, -9.8, -9.8, 0],
    },
  },
} as unknown as ChartFlight;

const meta = (key: string) => SERIES.find((m) => m.key === key)!;
const branch = (key: string, series: Partial<FlightSeries>): Branch =>
  ({ key, name: key, color: '#000', events: [], series }) as unknown as Branch;

describe('the live region', () => {
  it('reads a value to the decimals its panel header shows', () => {
    seedSettings({ flightSeries: ['velocity'] });
    renderWithProviders(<FlightChart flight={flight} />);
    fireEvent.keyDown(screen.getByRole('group', { name: /Flight charts/ }), { key: 'End' });
    const text = screen.getByRole('status').textContent ?? '';
    // The panel spans about 110 m/s, so its header carries no decimals; the
    // value under the crosshair (-5) must not pick up two of its own.
    expect(text).toMatch(/Velocity \S*5 m\/s/);
    expect(text).not.toContain('5.00');
  });
});

describe('the live region past the primary stage’s data', () => {
  it('reads no value where the panel header shows none', () => {
    seedSettings({ flightSeries: ['velocity', 'altitude'] });
    const ended = {
      ...flight,
      result: {
        ...flight.result,
        series: { ...flight.result.series, velocity: [0, 80, 0, -30, null] },
      },
    } as unknown as ChartFlight;
    renderWithProviders(<FlightChart flight={ended} />);
    fireEvent.keyDown(screen.getByRole('group', { name: /Flight charts/ }), { key: 'End' });
    const text = screen.getByRole('status').textContent ?? '';
    expect(text).toMatch(/Altitude/);
    expect(text).not.toMatch(/Velocity/);
  });
});

describe('a stage reports only inside its own flight', () => {
  // The primary stage lands at t = 2 while the other flies on to t = 4.
  const branches = [
    branch('sustainer', { time: [0, 1, 2], altitude: [0, 10, 5], velocity: [0, 8, 4] }),
    branch('booster', { time: [0, 1, 2, 3, 4], altitude: [0, 4, 6, 3, 0], velocity: [0, 2, 1, 0, 0] }),
  ];

  const panel = (hoverT: number | null) =>
    renderWithProviders(
      <FlightChartPanel
        meta={meta('altitude')}
        branches={branches}
        w={400}
        X={(t) => t * 100}
        hoverT={hoverT}
        clipT={4}
        events={[]}
      />,
    ).container;

  it('the panel header shows no value past the primary stage’s landing', () => {
    const head = panel(3).querySelector('.text-ink-strong')!.textContent ?? '';
    // Neither the peak (10) nor the clamped landing value (5).
    expect(head).toBe(NO_VALUE);
    expect(screen.queryByText('peak')).toBeNull();
  });

  it('the panel header names the peak when there is no crosshair', () => {
    const head = panel(null).querySelector('.text-ink-strong')!.textContent ?? '';
    expect(head).toMatch(/^10/);
    expect(screen.getByText('peak')).toBeTruthy();
  });

  it('the velocity-altitude panel draws no dot for a stage already down', () => {
    const { container } = renderWithProviders(
      <FlightXYPanel
        meta={meta('velocityAltitude')}
        branches={branches}
        w={400}
        height={200}
        hoverT={3}
        expanded={false}
        onToggleExpand={() => {}}
      />,
    );
    // Only the booster is still flying at t = 3.
    expect(container.querySelectorAll('circle')).toHaveLength(1);
  });

  const xyPanel = (hoverT: number | null) =>
    renderWithProviders(
      <FlightXYPanel
        meta={meta('velocityAltitude')}
        branches={branches}
        w={400}
        height={200}
        hoverT={hoverT}
        expanded={false}
        onToggleExpand={() => {}}
      />,
    ).container;

  it('the velocity-altitude header names the peak when there is no crosshair', () => {
    const head = xyPanel(null).querySelector('.text-ink-strong')!.textContent ?? '';
    expect(head).toMatch(/^8/);
    expect(screen.getByText('peak')).toBeTruthy();
  });

  // The screen reader's summary of the panel takes the largest magnitude, so
  // the header has to as well, or the two name different top speeds.
  it('the velocity-altitude header names a descent faster than the climb', () => {
    const descending = [branch('only', { time: [0, 1, 2, 3], altitude: [0, 10, 8, 2], velocity: [0, 5, -3, -12] })];
    const { container } = renderWithProviders(
      <FlightXYPanel
        meta={meta('velocityAltitude')}
        branches={descending}
        w={400}
        height={200}
        hoverT={null}
        expanded={false}
        onToggleExpand={() => {}}
      />,
    );
    const head = container.querySelector('.text-ink-strong')!.textContent ?? '';
    expect(head).toMatch(/12/);
  });

  it('the velocity-altitude header shows no value past the primary stage’s landing', () => {
    const head = xyPanel(3).querySelector('.text-ink-strong')!.textContent ?? '';
    // Not the primary stage's top speed (8).
    expect(head).toBe(NO_VALUE);
    expect(screen.queryByText('peak')).toBeNull();
  });
});

describe('the zoom-in button', () => {
  it('disables at the narrowest window', () => {
    seedSettings({ flightSeries: ['altitude'] });
    renderWithProviders(<FlightChart flight={flight} />);
    const zoomIn = screen.getByRole('button', { name: 'Zoom in' }) as HTMLButtonElement;
    expect(zoomIn.disabled).toBe(false);
    for (let i = 0; i < 30 && !zoomIn.disabled; i++) fireEvent.click(zoomIn);
    expect(zoomIn.disabled).toBe(true);
  });
});

describe('Escape on the crosshair', () => {
  it('is spent dropping a crosshair, and left alone when there is none', () => {
    seedSettings({ flightSeries: ['altitude'] });
    renderWithProviders(<FlightChart flight={flight} />);
    const host = screen.getByRole('group', { name: /Flight charts/ });
    fireEvent.focus(host);
    // fireEvent returns false once a handler called preventDefault.
    expect(fireEvent.keyDown(host, { key: 'Escape' })).toBe(false);
    expect(fireEvent.keyDown(host, { key: 'Escape' })).toBe(true);
  });
});

describe('Escape on the aero crosshair', () => {
  function Card() {
    const [hoverM, setHoverM] = useState<number | null>(null);
    return (
      <ChartCard
        title="Cd vs Mach"
        machs={[0.1, 0.2, 0.3]}
        machMin={0.1}
        machMax={0.3}
        series={[{ name: 'Power-off', color: '#000', values: [0.4, 0.5, 0.6] }]}
        unit=""
        digits={3}
        hoverM={hoverM}
        setHoverM={setHoverM}
      />
    );
  }

  it('is spent dropping a crosshair, and left alone when there is none', () => {
    renderWithProviders(<Card />);
    const host = screen.getByRole('group', { name: /arrow keys/ });
    fireEvent.keyDown(host, { key: 'End' });
    expect(fireEvent.keyDown(host, { key: 'Escape' })).toBe(false);
    expect(fireEvent.keyDown(host, { key: 'Escape' })).toBe(true);
  });
});

/**
 * The chart keeps at least one stage on, so the last chip on cannot do what it
 * looks like it does. It says so instead of taking the press in silence.
 */
describe('the stage chips', () => {
  const series = { time: [0, 1, 2], altitude: [0, 10, 0], velocity: [0, 5, 0], acceleration: [9, 0, -9] };
  const twoStage = {
    id: 'sim-2',
    name: 'Simulation 2',
    result: {
      summary: { flightTime: 2 },
      events: [],
      series,
      branches: [
        { name: 'Sustainer', events: [], series },
        { name: 'Booster', events: [], series },
      ],
    },
  } as unknown as ChartFlight;
  const chip = (name: string) => screen.getByRole('button', { name });

  it('marks the only stage still shown as unavailable, with the reason', () => {
    renderWithProviders(<FlightChart flight={twoStage} />);
    expect(chip('Sustainer').getAttribute('aria-disabled')).toBeNull();

    fireEvent.click(chip('Booster'));
    expect(chip('Booster').getAttribute('aria-pressed')).toBe('false');
    const last = chip('Sustainer');
    expect(last.getAttribute('aria-disabled')).toBe('true');
    expect(last.getAttribute('title')).toBe('At least one stage stays on the chart.');

    // Still shown after a press, and free again once another stage is back.
    fireEvent.click(last);
    expect(chip('Sustainer').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(chip('Booster'));
    expect(chip('Sustainer').getAttribute('aria-disabled')).toBeNull();
  });
});
