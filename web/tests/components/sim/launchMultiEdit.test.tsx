// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, cleanup } from '@testing-library/react';
import { LaunchPanel } from '../../../src/components/sim/LaunchPanel';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { useWorkspaceStore, selectActive } from '../../../src/state/store';
import { launchDiffKeys } from '../../../src/services/flight/simDiff';

const st = () => useWorkspaceStore.getState();
const byName = (n: string) => st().sims.find((x) => x.name === n)!;

/** The simulation editor's launch panel: the active row's conditions, edits to every ticked row. */
function Editor() {
  const launch = useWorkspaceStore((s) => selectActive(s).launch);
  const sims = useWorkspaceStore((s) => s.sims);
  const ticked = useWorkspaceStore((s) => s.selectedSimIds);
  const diff = launchDiffKeys(sims.filter((x) => ticked.includes(x.id)));
  return <LaunchPanel launch={launch} onChange={st().patchLaunch} diff={diff} />;
}

/**
 * An edit of several simulations at once works out a derived value from each
 * row's own conditions. OpenRocket keeps the turbulence intensity when the
 * average moves (PinkNoiseWindModel.setAverage), so each row keeps its own: a
 * 15% wind and a 30% wind stay 15% and 30% at the new speed, rather than both
 * taking the row on screen's deviation.
 */
describe('editing the wind of several simulations at once', () => {
  beforeEach(() => {
    st().resetWorkspace();
    while (st().sims.length > 1) st().deleteSim(st().sims[st().sims.length - 1]!.id);
    const a = st().sims[0]!.id;
    st().renameSim(a, 'A');
    st().setActiveId(a);
    st().patchLaunch({ windAverage: 5, windStdDev: 0.75 });
    st().addSim();
    const b = st().sims[1]!.id;
    st().renameSim(b, 'B');
    st().setActiveId(b);
    st().patchLaunch({ windAverage: 10, windStdDev: 3 });
    st().setActiveId(a);
    st().setSimsSelected([a, b]);
    st().commitEdit();
  });
  afterEach(cleanup);

  it('keeps each row its own turbulence when the speed changes', () => {
    renderWithProviders(<Editor />);
    const speed = screen.getByRole('spinbutton', { name: 'Speed' });
    fireEvent.focus(speed);
    for (const text of ['2', '20']) fireEvent.change(speed, { target: { value: text } });
    fireEvent.blur(speed);
    // The box is in the speed unit on screen; the ratio is what is kept.
    const ratio = (n: string) => byName(n).launch.windStdDev! / byName(n).launch.windAverage!;
    expect(byName('A').launch.windAverage).toBe(byName('B').launch.windAverage);
    expect(ratio('A')).toBeCloseTo(0.15, 9);
    expect(ratio('B')).toBeCloseTo(0.3, 9);
  });

  it('sets the turbulence percentage against each row’s own average', () => {
    renderWithProviders(<Editor />);
    fireEvent.change(screen.getByRole('spinbutton', { name: /turbulence intensity/i }), { target: { value: '20' } });
    expect(byName('A').launch.windStdDev).toBeCloseTo(1, 9);
    expect(byName('B').launch.windStdDev).toBeCloseTo(2, 9);
  });

  it('seeds each row’s wind profile from its own wind', () => {
    renderWithProviders(<Editor />);
    fireEvent.click(screen.getByRole('radio', { name: /multi/i }));
    expect(byName('A').launch.windLevels?.[0]?.speed).toBe(5);
    expect(byName('B').launch.windLevels?.[0]?.speed).toBe(10);
  });

  it('marks the wind model mixed when only some rows have a profile', () => {
    st().setActiveId(byName('B').id);
    st().patchActiveLaunch({ windLevels: [{ altitudeM: 0, speed: 10, directionDeg: 0, stddev: 3 }] });
    st().setActiveId(byName('A').id);
    renderWithProviders(<Editor />);
    const flagged = screen.getAllByTitle(/differ/).map((el) => el.textContent ?? '');
    expect(flagged.some((text) => text.startsWith('Wind model'))).toBe(true);
  });
});
