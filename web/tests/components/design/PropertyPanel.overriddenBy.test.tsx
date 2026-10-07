// @vitest-environment jsdom
import { beforeAll, describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { PropertyPanel } from '../../../src/components/design/PropertyPanel';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { serveData } from '../../testing/serveData';
import type { ComponentNode } from '../../../src/engine/openRocketEngine';

/**
 * Desktop's override tab: when an ancestor's override decides a value, the part
 * says which ancestor in red and its own override for that value is locked.
 */
beforeAll(serveData);

const ring = {
  id: 'r',
  type: 'centeringring',
  outerRadius: 0.012,
  innerRadius: 0.009,
  length: 0.003,
} as unknown as ComponentNode;

const show = (coveredBy?: Partial<Record<'mass' | 'cg' | 'cd', string>>) =>
  renderWithProviders(
    <PropertyPanel node={ring} onChange={vi.fn()} onCommit={() => {}} onRemove={() => {}} coveredBy={coveredBy} />,
  );

describe('an override decided by an ancestor', () => {
  it('names the ancestor and locks that override only', () => {
    show({ mass: 'Sustainer' });
    const note = screen.getByText('Mass overridden by Sustainer');
    expect(note.getAttribute('title')).toBe(
      'The mass of this component is determined by the mass override value of Sustainer',
    );
    const [mass, cg] = screen.getAllByRole('checkbox', { name: /^(Mass|CG)/ });
    expect((mass as HTMLInputElement).disabled).toBe(true);
    expect((cg as HTMLInputElement).disabled).toBe(false);
  });

  it('says nothing when no ancestor decides it', () => {
    show();
    expect(screen.queryByText(/overridden by/)).toBeNull();
  });
});
