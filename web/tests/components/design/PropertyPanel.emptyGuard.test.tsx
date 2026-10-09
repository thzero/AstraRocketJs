// @vitest-environment jsdom
import { beforeAll, describe, it, expect, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { PropertyPanel } from '../../../src/components/design/PropertyPanel';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { serveData } from '../../testing/serveData';
import type { ComponentNode } from '../../../src/engine/openRocketEngine';

const tube = (): ComponentNode =>
  ({
    id: 'tube',
    type: 'bodytube',
    name: 'Body tube',
    length: 0.2,
    outerRadius: 0.013,
    thickness: 0.0005,
  }) as unknown as ComponentNode;

const render = (onChange: (p: Partial<ComponentNode>) => void) =>
  renderWithProviders(
    <PropertyPanel node={tube()} onChange={onChange} onRemove={() => {}} canRemove isFirstStage={false} />,
  );

/**
 * Emptying a required dimension must not commit anything.
 *
 * Refusing to let focus leave the field would be a keyboard trap (WCAG 2.1.2)
 * and would fight anyone who clears a box in order to retype it. Withholding the
 * write gets the same guarantee (no accidental zero can reach the tree) without
 * taking the keyboard hostage.
 */
// The panel renders a MaterialPicker, which fetches the material catalog.
beforeAll(serveData);

describe('an emptied required dimension', () => {
  it('writes nothing when the box is cleared', () => {
    const onChange = vi.fn();
    render(onChange);
    const diameter = screen.getByLabelText('Diameter') as HTMLInputElement;

    fireEvent.focus(diameter);
    fireEvent.change(diameter, { target: { value: '' } });

    // Coerced to 0, an empty box would hand a zero to the tree.
    expect(onChange).not.toHaveBeenCalled();
  });

  it('still writes a real value typed into the same box', () => {
    const onChange = vi.fn();
    render(onChange);
    const diameter = screen.getByLabelText('Diameter') as HTMLInputElement;

    fireEvent.focus(diameter);
    fireEvent.change(diameter, { target: { value: '' } });
    fireEvent.change(diameter, { target: { value: '2' } });

    expect(onChange).toHaveBeenCalledTimes(1);
    // Typed as a diameter in cm, stored as a radius in meters: the box and the
    // node are two different numbers and the halving happens between them.
    expect(onChange.mock.calls[0]![0]).toEqual({ outerRadius: 0.01 });
  });

  it('still lets a DELIBERATE zero through, for the run gate to refuse', () => {
    // Clearing is an accident; typing 0 is a statement. The gate names it and
    // blocks the flight, so it does not need to be forbidden at the keystroke.
    const onChange = vi.fn();
    render(onChange);
    const diameter = screen.getByLabelText('Diameter') as HTMLInputElement;

    fireEvent.focus(diameter);
    fireEvent.change(diameter, { target: { value: '0' } });

    expect(onChange).toHaveBeenCalledWith({ outerRadius: 0 });
  });

  it('does not guard an OPTIONAL dimension, where clearing means zero', () => {
    // Motor overhang 0 is flush, and clearing it is a reasonable way to say so.
    const onChange = vi.fn();
    render(onChange);
    const overhang = screen.getByLabelText('Motor overhang') as HTMLInputElement;

    fireEvent.focus(overhang);
    fireEvent.change(overhang, { target: { value: '' } });

    expect(onChange).toHaveBeenCalledWith({ motorOverhang: 0 });
  });
});
