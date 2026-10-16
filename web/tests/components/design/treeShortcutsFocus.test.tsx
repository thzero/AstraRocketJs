// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { TreePanel } from '../../../src/components/design/TreePanel';
import { useWorkspaceStore } from '../../../src/state/store';
import type { RocketTree } from '../../../src/engine/openRocketEngine';

/**
 * The Edit shortcuts act on the row the keyboard is on.
 *
 * Desktop's component tree is a Swing JTree, whose arrow keys move the
 * selection, so Ctrl+C after an arrow key copies the part the arrow reached.
 * Here the arrows move focus without selecting, so the shortcut has to target
 * the focused row, and selects it, as desktop's would be.
 */
const TREE = {
  name: 'Test',
  components: [
    {
      id: 's1',
      type: 'stage',
      name: 'Sustainer',
      children: [
        { id: 'n1', type: 'nosecone', name: 'Nose', length: 0.1 },
        { id: 'b1', type: 'bodytube', name: 'Body', length: 0.3 },
      ],
    },
  ],
} as unknown as RocketTree;

const row = (name: RegExp) => screen.getByRole('treeitem', { name });

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});

beforeEach(() => {
  useWorkspaceStore.setState({ tree: TREE, selectedId: 'b1', clipboard: null });
});

describe('tree shortcuts on the focused row', () => {
  it('copies the row the arrow key reached, not the earlier selection', () => {
    renderWithProviders(<TreePanel />);
    row(/Body/).focus();
    fireEvent.keyDown(row(/Body/), { key: 'ArrowUp' });
    expect(document.activeElement).toBe(row(/Nose/));
    fireEvent.keyDown(row(/Nose/), { key: 'c', ctrlKey: true });
    expect(useWorkspaceStore.getState().clipboard?.id).toBe('n1');
    expect(useWorkspaceStore.getState().selectedId).toBe('n1');
  });

  it('still acts on the selected row when focus is on it', () => {
    renderWithProviders(<TreePanel />);
    row(/Body/).focus();
    fireEvent.keyDown(row(/Body/), { key: 'c', ctrlKey: true });
    expect(useWorkspaceStore.getState().clipboard?.id).toBe('b1');
    expect(useWorkspaceStore.getState().selectedId).toBe('b1');
  });
});
