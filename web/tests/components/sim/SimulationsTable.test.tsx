// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { SimulationsTable } from '../../../src/components/sim/SimulationsTable';
import { useWorkspaceStore } from '../../../src/state/store';
import { renderWithProviders } from '../../testing/renderWithProviders';
import type { FlightResult } from '../../../src/engine/openRocketEngine';

/**
 * The warning count on a row is the only pointer to what a run flagged. It has
 * to be reachable from a keyboard and readable by a screen reader, not a
 * tooltip on a span.
 */
describe('SimulationsTable warning count', () => {
  it('is a button that opens the results and describes each warning', () => {
    const s = useWorkspaceStore.getState();
    const sim = s.sims[0]!;
    const result = {
      summary: {
        maxAltitude: 100,
        maxVelocity: 50,
        maxAcceleration: 100,
        maxMachNumber: 0.2,
        timeToApogee: 4,
        flightTime: 30,
        groundHitVelocity: 5,
        launchRodVelocity: 20,
        deploymentVelocity: null,
        optimumDelay: null,
      },
      events: [],
      series: { time: [0] },
      warnings: [{ key: 'Other', message: 'Something odd happened', priority: 'NORMAL' }],
    } as unknown as FlightResult;
    const onOpenResults = vi.fn();
    renderWithProviders(
      <SimulationsTable
        sims={[{ ...sim, result }]}
        activeId={sim.id}
        selectedIds={[]}
        runs={{}}
        tree={s.tree}
        configs={s.configs}
        simPrefs={s.simPrefs}
        onSetConfig={() => {}}
        onSelect={() => {}}
        onToggle={() => {}}
        onToggleAll={() => {}}
        onOpenResults={onOpenResults}
      />,
    );
    const count = screen.getByRole('button', { name: 'Flight warnings (1)' });
    expect(count.getAttribute('aria-describedby')).toBeTruthy();
    expect(document.getElementById(count.getAttribute('aria-describedby')!)?.textContent).toContain(
      'Something odd happened',
    );
    fireEvent.click(count);
    expect(onOpenResults).toHaveBeenCalledWith(sim.id);
  });
});

describe('SimulationsPane run-table export', () => {
  it('is named for what it does, not for its arrow glyph', async () => {
    // jsdom has no matchMedia; answer "desktop", where the editor is a column of
    // its own and the pane is the toolbar and the table.
    window.matchMedia = ((query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    })) as unknown as typeof window.matchMedia;
    const { SimulationsPane } = await import('../../../src/components/sim/SimulationsPane');
    renderWithProviders(<SimulationsPane />);
    expect(
      screen.getByRole('button', { name: 'Download the run table: every simulation and its results, as CSV' }),
    ).toBeTruthy();
  });
});
