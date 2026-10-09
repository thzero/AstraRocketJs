// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { OverridesSection } from '../../../src/components/design/OverridesSection';
import { renderWithProviders } from '../../testing/renderWithProviders';
import type { ComponentNode } from '../../../src/engine/openRocketEngine';

/**
 * Select-all and retype empties an override box for a moment. That empty box
 * is not a typed 0: writing one would fly a 0 kg part (or a whole 0 kg stage
 * with "apply to all subcomponents" on) on every keystroke.
 */
const node = {
  id: 's',
  type: 'stage',
  overrideMass: 0.5,
  overrideCGX: 0.2,
  overrideCD: 0.6,
} as unknown as ComponentNode;

describe('OverridesSection with a cleared box', () => {
  it.each([
    ['Mass', 'overrideMass'],
    ['CG (from nose tip)', 'overrideCGX'],
    ['Drag coeff (Cd)', 'overrideCD'],
  ])('writes nothing while the %s box is empty', (label) => {
    const onChange = vi.fn();
    renderWithProviders(<OverridesSection node={node} onChange={onChange} />);
    const box = screen.getByRole('spinbutton', { name: label });
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: '' } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('still writes a typed value', () => {
    const onChange = vi.fn();
    renderWithProviders(<OverridesSection node={node} onChange={onChange} />);
    const box = screen.getByRole('spinbutton', { name: 'Drag coeff (Cd)' });
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: '0.7' } });
    expect(onChange).toHaveBeenCalledWith({ overrideCD: 0.7 });
  });
});
