// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { SeparationSection } from '../../../src/components/config/SeparationSection';
import { useWorkspaceStore, selectConfig } from '../../../src/state/store';
import { findStages } from '../../../src/services/design/treeEdit';

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
    renderWithProviders(<SeparationSection config={selectConfig(st())} stage={stage} separates={index > 0} />);
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
