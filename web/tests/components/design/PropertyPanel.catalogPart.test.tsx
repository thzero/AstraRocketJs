// @vitest-environment jsdom
import { beforeAll, describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { PropertyPanel } from '../../../src/components/design/PropertyPanel';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { serveData } from '../../testing/serveData';
import { updateNode } from '../../../src/services/design/treeEdit';
import type { ComponentNode, RocketTree } from '../../../src/engine/openRocketEngine';

/**
 * Which catalog part a component is, on screen.
 *
 * The picker writes the link (`presetRef`) and the `.ork` writer carries it, so
 * the panel shows it too: otherwise a design built from real Estes parts, the
 * default one included, reads as though every dimension had been typed by hand.
 * The desktop's own config dialog names the preset, which is the whole point of
 * picking one.
 *
 * The second test is the other half of the contract: the link is only true while
 * the dimensions are the part's, so the row has to go when an edit breaks it.
 */
beforeAll(serveData);

const nose = (extra: Record<string, unknown> = {}) =>
  ({
    id: 'nose',
    type: 'nosecone',
    shape: 'ogive',
    length: 0.06985,
    aftRadius: 0.0123952,
    thickness: 0.0013,
    ...extra,
  }) as unknown as ComponentNode;

const LINK = { type: 'nosecone', manufacturer: 'Estes', partNo: 'PNC-50KA' };

const show = (node: ComponentNode) =>
  renderWithProviders(<PropertyPanel node={node} onChange={vi.fn()} onCommit={() => {}} onRemove={() => {}} />);

describe('the catalog part a component came from', () => {
  it('names the part and its manufacturer', () => {
    show(nose({ preset: LINK }));
    const row = screen.getByText('Catalog part').parentElement!;
    expect(row.textContent).toContain('PNC-50KA');
    expect(row.textContent).toContain('Estes');
  });

  it('says nothing for a part that was typed rather than picked', () => {
    show(nose());
    expect(screen.queryByText('Catalog part')).toBeNull();
  });

  it('goes away when an edit breaks the link', () => {
    // `breaksPreset` drops the link the moment a stated dimension moves, because
    // the part is no longer the part. The row is driven by the link alone, so
    // this is what a reader sees when they retype a length.
    const tree = { components: [nose({ preset: LINK })] } as unknown as RocketTree;
    const edited = updateNode(tree, 'nose', { length: 0.08 });
    const node = (edited as unknown as { components: ComponentNode[] }).components[0]!;
    expect(node['preset']).toBeUndefined();

    show(node);
    expect(screen.queryByText('Catalog part')).toBeNull();
  });
});
