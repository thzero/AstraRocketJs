// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { SeparationSection } from '../../../src/components/config/SeparationSection';
import { useWorkspaceStore, selectConfig } from '../../../src/state/store';
import { findStages } from '../../../src/services/design/treeEdit';
import { SEPARATION_EVENTS } from '../../../src/services/design/componentFields';

const st = () => useWorkspaceStore.getState();

/**
 * Something has to fly, so the only stage still flying cannot be grounded. Its
 * checkbox says so instead of looking clickable and doing nothing.
 */
describe('SeparationSection flies checkbox', () => {
  beforeEach(() => {
    st().resetWorkspace();
    st().addStageToTree();
  });

  const render = (index: number) => {
    const stage = findStages(st().tree)[index]!;
    renderWithProviders(
      <SeparationSection config={selectConfig(st())} stage={stage} index={index} separates={index > 0} />,
    );
    return screen.getByRole('checkbox') as HTMLInputElement;
  };

  it('is enabled while another stage also flies', () => {
    const box = render(1);
    expect(box.disabled).toBe(false);
    expect(box.title).toBe('');
  });

  it('is disabled, with the reason, on the only stage still flying', () => {
    const [, booster] = findStages(st().tree);
    st().setStageFlies(selectConfig(st()).id, booster!.id as string, false);
    const box = render(0);
    expect(box.checked).toBe(true);
    expect(box.disabled).toBe(true);
    expect(box.title).toMatch(/at least one stage/i);
  });
});

/** The override offers the property panel's own list of separation events. */
describe('SeparationSection event override', () => {
  beforeEach(() => {
    st().resetWorkspace();
    st().addStageToTree();
  });

  it('lists every separation event the property panel offers', () => {
    const stage = findStages(st().tree)[1]!;
    renderWithProviders(<SeparationSection config={selectConfig(st())} stage={stage} index={1} separates />);
    const select = screen
      .getAllByRole('combobox')
      .find((s) => [...(s as HTMLSelectElement).options].some((o) => o.value === 'ejection')) as HTMLSelectElement;
    const offered = [...select.options].map((o) => o.value).filter((v) => v !== '');
    expect(offered).toEqual([...SEPARATION_EVENTS]);
  });

  // StageSeparationConfiguration reads the altitude for its two altitude events
  // only; under any other event the box would set a number nothing reads.
  it('offers the altitude under an altitude event alone', () => {
    const stage = findStages(st().tree)[1]!;
    const config = selectConfig(st());
    const { unmount } = renderWithProviders(<SeparationSection config={config} stage={stage} index={1} separates />);
    expect(screen.queryByRole('spinbutton', { name: /altitude/i })).toBeNull();
    unmount();
    const onAltitude = {
      ...config,
      separations: { [stage.id as string]: { separationEvent: 'altitudeascending' } },
    } as unknown as typeof config;
    renderWithProviders(<SeparationSection config={onAltitude} stage={stage} index={1} separates />);
    expect(screen.getByRole('spinbutton', { name: /altitude/i })).toBeTruthy();
  });
});
