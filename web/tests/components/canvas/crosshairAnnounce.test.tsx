// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
import { ChartCard } from '../../../src/components/canvas/AeroCharts';
import { FlightChart, type ChartFlight } from '../../../src/components/canvas/FlightChart';
import { renderWithProviders, seedSettings } from '../../testing/renderWithProviders';

/**
 * The keyboard crosshairs announce what they land on. A key step puts the
 * position and every series' value into a polite live region; a pointer move
 * leaves the region alone, or a screen reader would queue one announcement per
 * mouse sample.
 */
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('aero chart crosshair', () => {
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

  it('announces the Mach and each value on a key step', () => {
    renderWithProviders(<Card />);
    const host = screen.getByRole('group', { name: /arrow keys/ });
    fireEvent.focus(host);
    fireEvent.keyDown(host, { key: 'End' });
    const text = screen.getByRole('status').textContent ?? '';
    expect(text).toContain('0.30');
    expect(text).toContain('Power-off 0.600');
  });

  it('stays quiet on a pointer move', () => {
    renderWithProviders(<Card />);
    const host = screen.getByRole('group', { name: /arrow keys/ });
    fireEvent.pointerMove(host, { clientX: 200, clientY: 20 });
    expect(screen.getByRole('status').textContent).toBe('');
  });
});

describe('flight chart crosshair', () => {
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

  it('announces the time and the shown panels’ values on a key step', () => {
    seedSettings({ flightSeries: ['altitude', 'velocity'] });
    renderWithProviders(<FlightChart flight={flight} />);
    const host = screen.getByRole('group', { name: /Flight charts/ });
    fireEvent.keyDown(host, { key: 'End' });
    const text = screen.getByRole('status').textContent ?? '';
    expect(text).toMatch(/^Time 4\.00 s: /);
    expect(text).toContain('Altitude 0');
    expect(text).toContain('Velocity');
  });

  it('stays quiet on a pointer move', () => {
    seedSettings({ flightSeries: ['altitude'] });
    renderWithProviders(<FlightChart flight={flight} />);
    const host = screen.getByRole('group', { name: /Flight charts/ });
    fireEvent.pointerMove(host, { clientX: 200, clientY: 20 });
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('names the CSV button by what it downloads', () => {
    renderWithProviders(<FlightChart flight={flight} />);
    expect(screen.getByRole('button', { name: 'Download flight data (.csv)' })).toBeTruthy();
  });
});
