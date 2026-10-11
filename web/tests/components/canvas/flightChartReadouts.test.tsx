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
    // The panel spans about 120 m/s, so its header carries no decimals; the
    // value under the crosshair (-5) must not pick up two of its own.
    expect(text).toMatch(/Velocity \S*5 m\/s/);
    expect(text).not.toContain('5.00');
  });
});

describe('a stage reports only inside its own flight', () => {
  // The primary stage lands at t = 2 while the other flies on to t = 4.
  const branches = [
    branch('sustainer', { time: [0, 1, 2], altitude: [0, 10, 5], velocity: [0, 8, 4] }),
    branch('booster', { time: [0, 1, 2, 3, 4], altitude: [0, 4, 6, 3, 0], velocity: [0, 2, 1, 0, 0] }),
  ];

  it('the panel header falls back to the peak past the primary stage’s landing', () => {
    const { container } = renderWithProviders(
      <FlightChartPanel
        meta={meta('altitude')}
        branches={branches}
        w={400}
        X={(t) => t * 100}
        hoverT={3}
        clipT={4}
        events={[]}
      />,
    );
    const head = container.querySelector('.text-ink-strong')!.textContent ?? '';
    // The peak (10), not the clamped landing value (5).
    expect(head).toMatch(/^10/);
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
