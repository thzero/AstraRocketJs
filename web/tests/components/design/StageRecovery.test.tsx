// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { StageRecovery } from '../../../src/components/design/StageRecovery';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { useWorkspaceStore } from '../../../src/state/store';
import { recoveryDevices } from '../../../src/services/treeEdit';
import type { ComponentNode, RocketTree } from '../../../src/engine/openRocketEngine';

/**
 * The stage's Recovery section: OpenRocket's own tab, and the only place it lets
 * the drogue be chosen. Ours was a checkbox on each chute, which could mark two
 * in one stage.
 */

const chute = (id: string, name: string): ComponentNode =>
  ({ id, type: 'parachute', name, diameter: 0.4, lineCount: 6 }) as unknown as ComponentNode;

const tree = (devices: ComponentNode[]): RocketTree =>
  ({
    name: 'R',
    components: [
      {
        id: 'st',
        type: 'stage',
        name: 'Sustainer',
        children: [
          { id: 'tube', type: 'bodytube', length: 0.4, outerRadius: 0.026, thickness: 0.001, children: devices },
        ],
      },
    ],
  }) as unknown as RocketTree;

const stage = () => ({ id: 'st', type: 'stage', name: 'Sustainer' }) as unknown as ComponentNode;
const seed = (devices: ComponentNode[]) => useWorkspaceStore.setState({ tree: tree(devices) });
const marked = () =>
  recoveryDevices(useWorkspaceStore.getState().tree, 'st')
    .filter((d) => d['drogue'] === true)
    .map((d) => d.name);

const radio = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

describe('a stage chooses single or dual deployment', () => {
  beforeEach(() => seed([chute('main', 'Main chute'), chute('drg', 'Drogue chute')]));

  it('starts on single deployment when no device is marked', () => {
    renderWithProviders(<StageRecovery node={stage()} />);
    expect(radio('Single deployment').checked).toBe(true);
    expect(radio('Dual deployment').checked).toBe(false);
  });

  it('offers every recovery device in the stage by name', () => {
    renderWithProviders(<StageRecovery node={stage()} />);
    const picker = screen.getByLabelText('Drogue device') as HTMLSelectElement;
    expect([...picker.options].map((o) => o.text)).toEqual(['Main chute', 'Drogue chute']);
  });

  it('leaves the picker disabled until dual deployment is chosen', () => {
    renderWithProviders(<StageRecovery node={stage()} />);
    const picker = screen.getByLabelText('Drogue device') as HTMLSelectElement;
    // A single-deployment stage has no drogue, so the picker is a readout of
    // what WOULD become one rather than a control.
    expect(picker.disabled).toBe(true);
    fireEvent.click(radio('Dual deployment'));
    expect((screen.getByLabelText('Drogue device') as HTMLSelectElement).disabled).toBe(false);
  });

  it('marks the shown device when dual deployment is chosen', () => {
    renderWithProviders(<StageRecovery node={stage()} />);
    fireEvent.click(radio('Dual deployment'));
    expect(marked()).toEqual(['Main chute']);
  });

  it('moves the flag rather than adding a second one', () => {
    renderWithProviders(<StageRecovery node={stage()} />);
    fireEvent.click(radio('Dual deployment'));
    fireEvent.change(screen.getByLabelText('Drogue device'), { target: { value: 'drg' } });
    expect(marked()).toEqual(['Drogue chute']);
  });

  it('clears the stage when single deployment is chosen again', () => {
    renderWithProviders(<StageRecovery node={stage()} />);
    fireEvent.click(radio('Dual deployment'));
    fireEvent.click(radio('Single deployment'));
    expect(marked()).toEqual([]);
  });
});

describe('a stage with nothing to deploy', () => {
  beforeEach(() => seed([]));

  it('refuses dual deployment and says why', () => {
    renderWithProviders(<StageRecovery node={stage()} />);
    // Not a picker with nothing in it: there is no choice to make, so the
    // option is disabled and the reason is on screen.
    expect(radio('Dual deployment').disabled).toBe(true);
    expect(screen.queryByLabelText('Drogue device')).toBeNull();
    expect(screen.getByText('No recovery devices in this stage')).toBeTruthy();
  });
});
