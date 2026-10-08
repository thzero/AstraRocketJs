// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { ComponentActions } from '../../../src/components/design/ComponentActions';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { useWorkspaceStore } from '../../../src/state/store';
import type { ComponentNode, RocketTree } from '../../../src/engine/openRocketEngine';

/**
 * The actions row. What is tested here is the offer (which buttons a part gets,
 * and which are refused with a reason) plus that pressing one reaches the store
 * as a single undoable step. The transforms themselves are covered by
 * services/design/componentActions.test.ts.
 */

const node = (o: Record<string, unknown>): ComponentNode => o as unknown as ComponentNode;

const seed = (part: ComponentNode) =>
  useWorkspaceStore.setState({
    tree: {
      name: 'R',
      components: [
        {
          id: 'st',
          type: 'stage',
          children: [
            { id: 'tube', type: 'bodytube', length: 0.4, outerRadius: 0.026, thickness: 0.001, children: [part] },
          ],
        },
      ],
    } as unknown as RocketTree,
  });

const kids = (): ComponentNode[] => {
  const t = useWorkspaceStore.getState().tree;
  return ((t.components[0]!.children as ComponentNode[])[0]!.children ?? []) as ComponentNode[];
};

const fins = (extra: Record<string, unknown> = {}) =>
  node({
    id: 'fins',
    type: 'trapezoidfinset',
    finCount: 3,
    rootChord: 0.05,
    tipChord: 0.03,
    sweep: 0.02,
    height: 0.04,
    ...extra,
  });

const button = (label: string) => screen.getByRole('button', { name: label }) as HTMLButtonElement;

describe('which actions a part is offered', () => {
  it('gives a trapezoid fin set Convert and Split', () => {
    seed(fins());
    renderWithProviders(<ComponentActions node={fins()} />);
    expect(button('Convert to freeform').disabled).toBe(false);
    expect(button('Split fins').disabled).toBe(false);
  });

  it('gives a freeform fin set Split but not Convert, since it already is one', () => {
    const ff = node({ id: 'ff', type: 'freeformfinset', finCount: 4, points: [[0, 0]] });
    seed(ff);
    renderWithProviders(<ComponentActions node={ff} />);
    expect(screen.queryByRole('button', { name: 'Convert to freeform' })).toBeNull();
    expect(button('Split fins').disabled).toBe(false);
  });

  it('disables Split on a single fin rather than hiding it', () => {
    // This is exactly when someone goes looking for the button, so it stays on
    // screen and its tooltip says why.
    const one = fins({ finCount: 1 });
    seed(one);
    renderWithProviders(<ComponentActions node={one} />);
    const b = button('Split fins');
    expect(b.disabled).toBe(true);
    expect(b.title).toBe('There is only one of these to split');
  });

  it('says how many pieces a split would make', () => {
    seed(fins());
    renderWithProviders(<ComponentActions node={fins()} />);
    expect(button('Split fins').title).toBe('Split into 3 separate single parts');
  });

  it('names the pieces after the part: pods for a pod set, boosters for a booster', () => {
    const pod = node({ id: 'pod', type: 'podset', instanceCount: 2 });
    seed(pod);
    renderWithProviders(<ComponentActions node={pod} />);
    expect(button('Split pods').disabled).toBe(false);
  });

  it('gives an inner tube the two cluster actions, both refused on a single tube', () => {
    const tube = node({ id: 'mount', type: 'innertube', length: 0.07, outerRadius: 0.0095, cluster: 'single' });
    seed(tube);
    renderWithProviders(<ComponentActions node={tube} />);
    expect(button('Split cluster').disabled).toBe(true);
    expect(button('Reset settings').disabled).toBe(true);
  });

  it('enables Reset only when there is something to reset', () => {
    const tube = (extra: Record<string, unknown>) =>
      node({ id: 'mount', type: 'innertube', length: 0.07, outerRadius: 0.0095, cluster: '3-ring', ...extra });
    seed(tube({ clusterScale: 1, clusterRotation: 0 }));
    const { unmount } = renderWithProviders(<ComponentActions node={tube({ clusterScale: 1, clusterRotation: 0 })} />);
    expect(button('Reset settings').disabled).toBe(true);
    unmount();
    renderWithProviders(<ComponentActions node={tube({ clusterScale: 1.5, clusterRotation: 0 })} />);
    expect(button('Reset settings').disabled).toBe(false);
  });

  it('renders nothing for a part with no actions', () => {
    const tube = node({ id: 'bt', type: 'bodytube', length: 0.2, outerRadius: 0.013 });
    seed(tube);
    const { container } = renderWithProviders(<ComponentActions node={tube} />);
    expect(container.innerHTML).toBe('');
  });
});

describe('pressing one', () => {
  beforeEach(() => seed(fins()));

  it('converts the fin set in the store', () => {
    renderWithProviders(<ComponentActions node={fins()} />);
    fireEvent.click(button('Convert to freeform'));
    expect(kids()[0]!.type).toBe('freeformfinset');
  });

  it('splits it, numbering the copies after its display name', () => {
    renderWithProviders(<ComponentActions node={fins()} />);
    fireEvent.click(button('Split fins'));
    // Unnamed, so the copies are numbered off the type's own label.
    expect(kids().map((n) => n.name)).toEqual([
      'Trapezoidal fin set #1',
      'Trapezoidal fin set #2',
      'Trapezoidal fin set #3',
    ]);
  });

  it('is one undo step, and undo puts the fin set back', () => {
    renderWithProviders(<ComponentActions node={fins()} />);
    fireEvent.click(button('Split fins'));
    expect(kids()).toHaveLength(3);
    useWorkspaceStore.getState().undo();
    expect(kids()).toHaveLength(1);
    expect(kids()[0]!['finCount']).toBe(3);
  });
});
