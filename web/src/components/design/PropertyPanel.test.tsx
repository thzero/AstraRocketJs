// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { PropertyPanel } from './PropertyPanel';
import { renderWithProviders } from '../../testing/renderWithProviders';
import type { ComponentNode } from '../../engine/openRocketEngine';

const show = (node: ComponentNode, extra: { parentRadius?: number } = {}) => {
  const onChange = vi.fn();
  renderWithProviders(
    <PropertyPanel node={node} onChange={onChange} onCommit={() => {}} onRemove={() => {}} {...extra} />,
  );
  return onChange;
};

/**
 * The two design-panel validators that shipped with no way to reach them.
 *
 * `tree/cluster.ts` and `tree/tubefins.ts` both had exported, tested helpers
 * that nothing in the app called — the cluster options list and the tube-fin
 * collision limits. Each is wired into this panel now, and these tests are what
 * stop them going quiet again.
 */
describe('cluster selection', () => {
  /**
   * `cluster` round-trips through .ork and every view (2D, aft, 3D) already
   * drew the tube at each cluster offset — but nothing could SET it, so the
   * only way to have a cluster was to import a file that already did.
   */
  it('offers every cluster pattern on a motor mount', () => {
    show({ id: 'm1', type: 'innertube', motorMount: true } as unknown as ComponentNode);
    const sel = screen.getByLabelText('Cluster') as HTMLSelectElement;
    const values = [...sel.options].map((o) => o.value);
    expect(values).toContain('single');
    expect(values).toContain('double');
    expect(values).toContain('9-grid');
  });

  it('labels each pattern with how many motors it holds', () => {
    show({ id: 'm1', type: 'innertube' } as unknown as ComponentNode);
    const sel = screen.getByLabelText('Cluster') as HTMLSelectElement;
    const text = Object.fromEntries([...sel.options].map((o) => [o.value, o.textContent]));
    expect(text.single).toBe('Single');
    expect(text.double).toBe('double (2 motors)');
    expect(text['9-grid']).toBe('9-grid (9 motors)');
  });

  it('writes the chosen pattern to the node', () => {
    const onChange = show({ id: 'm1', type: 'innertube' } as unknown as ComponentNode);
    fireEvent.change(screen.getByLabelText('Cluster'), { target: { value: '4-ring' } });
    expect(onChange).toHaveBeenCalledWith({ cluster: '4-ring' });
  });

  it('shows the stored pattern rather than defaulting the control to single', () => {
    show({ id: 'm1', type: 'innertube', cluster: '3-ring' } as unknown as ComponentNode);
    expect((screen.getByLabelText('Cluster') as HTMLSelectElement).value).toBe('3-ring');
  });
});

describe('tube fin collision warning', () => {
  const tubeFins = (finCount: number, outerRadius: number) =>
    ({ id: 'tf', type: 'tubefinset', finCount, outerRadius, length: 0.1 }) as unknown as ComponentNode;
  const warning = () => screen.queryByText(/tubes overlap/i);

  it('says nothing while the tubes fit', () => {
    // 6 tubes of r=10 mm around a 50 mm body: the touching radius there is
    // 50·sin(30°)/(1−sin(30°)) = 50 mm, so 10 mm is comfortable.
    show(tubeFins(6, 0.01), { parentRadius: 0.05 });
    expect(warning()).toBeNull();
  });

  it('warns once they overlap, and says what does fit', () => {
    // 12 tubes of r=20 mm around the same body cannot physically close.
    show(tubeFins(12, 0.02), { parentRadius: 0.05 });
    const w = warning();
    expect(w).toBeTruthy();
    // Both ways out are offered: fewer tubes, or thinner ones.
    expect(w!.textContent).toMatch(/at most 10 fit/);
    expect(w!.textContent).toMatch(/largest that fits is/);
  });

  it('stays quiet when the body radius is unknown', () => {
    // A tube fin set with no parent radius (not yet attached, or a parent with
    // no radius) must not accuse the user of a collision it cannot check.
    show(tubeFins(12, 0.02));
    expect(warning()).toBeNull();
  });

  it('allows an exactly-touching set', () => {
    // 3 tubes at precisely the touching radius is a legal, if tight, build.
    const s = Math.sin(Math.PI / 3);
    show(tubeFins(3, (0.05 * s) / (1 - s)), { parentRadius: 0.05 });
    expect(warning()).toBeNull();
  });

  it('does not warn on other part types', () => {
    show({ id: 'f1', type: 'trapezoidfinset', finCount: 12 } as unknown as ComponentNode, { parentRadius: 0.05 });
    expect(warning()).toBeNull();
  });
});
