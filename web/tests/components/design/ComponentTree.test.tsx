// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { ComponentTree } from '../../../src/components/design/ComponentTree';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { SettingsProvider } from '../../../src/state/SettingsProvider';
import type { RocketTree } from '../../../src/engine/openRocketEngine';

const TREE = {
  name: 'Test',
  components: [
    {
      id: 's1',
      type: 'stage',
      name: 'Sustainer',
      children: [
        { id: 'n1', type: 'nosecone', name: 'Nose', length: 0.1 },
        { id: 'b1', type: 'bodytube', name: 'Body', length: 0.3, children: [{ id: 'l1', type: 'launchlug' }] },
      ],
    },
  ],
} as unknown as RocketTree;

/**
 * Rows are tree items, not `role="button"`: a button may not contain interactive
 * content such as the fold toggle and the export button, and a button says
 * nothing about depth, folding or selection. A real tree carries all three, with
 * the same keyboard model.
 */
describe('ComponentTree semantics', () => {
  // jsdom does not lay out, so it has no scrollIntoView; the selected row
  // calls it on mount.
  beforeAll(() => {
    Element.prototype.scrollIntoView = () => {};
  });

  it('is a tree of tree items with level, expansion and selection', () => {
    renderWithProviders(<ComponentTree tree={TREE} selectedId="b1" onSelect={() => {}} />);
    screen.getByRole('tree', { name: 'Components' });
    const stage = screen.getByRole('treeitem', { name: /Sustainer/ });
    const body = screen.getByRole('treeitem', { name: /Body/ });
    const nose = screen.getByRole('treeitem', { name: /Nose/ });
    expect(stage.getAttribute('aria-level')).toBe('1');
    expect(body.getAttribute('aria-level')).toBe('2');
    expect(screen.getByRole('treeitem', { name: /Launch lug/ }).getAttribute('aria-level')).toBe('3');
    expect(stage.getAttribute('aria-expanded')).toBe('true');
    expect(nose.getAttribute('aria-expanded')).toBeNull(); // a leaf folds nothing
    expect(body.getAttribute('aria-selected')).toBe('true');
    expect(nose.getAttribute('aria-selected')).toBe('false');
  });

  it('still selects with Enter and folds with the arrow keys', () => {
    const onSelect = vi.fn();
    renderWithProviders(<ComponentTree tree={TREE} onSelect={onSelect} />);
    const stage = screen.getByRole('treeitem', { name: /Sustainer/ });
    fireEvent.keyDown(stage, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('s1');
    fireEvent.keyDown(stage, { key: 'ArrowLeft' });
    expect(screen.getByRole('treeitem', { name: /Sustainer/ }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('treeitem', { name: /Nose/ })).toBeNull();
  });
});

/**
 * Keyboard focus stays in the tree across an edit that rebuilds it. Cut removes
 * the focused row and undo or redo replaces the rows; without this, focus fell to
 * the page and the arrow keys did nothing until the user tabbed back in.
 */
describe('ComponentTree focus across an edit', () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = () => {};
  });
  const WITHOUT_BODY = {
    ...TREE,
    components: [{ ...TREE.components[0]!, children: [TREE.components[0]!.children![0]!] }],
  } as RocketTree;
  const row = (name: RegExp) => screen.getByRole('treeitem', { name });
  const tick = () => new Promise((r) => setTimeout(r, 0));
  // rerender replaces the whole element, so each one carries the provider.
  const view = (ui: React.ReactElement) => <SettingsProvider>{ui}</SettingsProvider>;

  it('keeps focus on a row when the focused row is cut, and follows the selection undo restores', () => {
    const { rerender } = renderWithProviders(<ComponentTree tree={TREE} selectedId="b1" onSelect={() => {}} />);
    row(/Body/).focus();
    rerender(view(<ComponentTree tree={WITHOUT_BODY} selectedId={null} onSelect={() => {}} />));
    expect(document.activeElement?.getAttribute('role')).toBe('treeitem');

    rerender(view(<ComponentTree tree={TREE} selectedId="b1" onSelect={() => {}} />));
    expect(document.activeElement).toBe(row(/Body/));
  });

  it('leaves focus where the arrow keys put it when the selection does not change', () => {
    const { rerender } = renderWithProviders(<ComponentTree tree={TREE} selectedId="b1" onSelect={() => {}} />);
    row(/Body/).focus();
    fireEvent.keyDown(row(/Body/), { key: 'ArrowUp' });
    expect(document.activeElement).toBe(row(/Nose/));
    rerender(view(<ComponentTree tree={{ ...TREE }} selectedId="b1" onSelect={() => {}} />));
    expect(document.activeElement).toBe(row(/Nose/));
  });

  it('does not pull focus back after the user moved it away', async () => {
    const { rerender } = renderWithProviders(<ComponentTree tree={TREE} selectedId="b1" onSelect={() => {}} />);
    row(/Body/).focus();
    row(/Body/).blur();
    await tick();
    rerender(view(<ComponentTree tree={WITHOUT_BODY} selectedId={null} onSelect={() => {}} />));
    expect(document.activeElement).toBe(document.body);
  });
});
