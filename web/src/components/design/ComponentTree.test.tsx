// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { ComponentTree } from './ComponentTree';
import { renderWithProviders } from '../../testing/renderWithProviders';
import type { RocketTree } from '../../engine/openRocketEngine';

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
 * Rows were `role="button"` with the fold toggle and the export button nested
 * inside, which is invalid (a button may not contain interactive content) and
 * said nothing about depth, folding or selection. A real tree carries all
 * three, and the keyboard model is unchanged.
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
