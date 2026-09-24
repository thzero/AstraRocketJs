// @vitest-environment jsdom
import { beforeAll, describe, it, expect, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { PropertyPanel } from './PropertyPanel';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { serveData } from '../../testing/serveData';
import type { ComponentNode } from '../../engine/openRocketEngine';

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
 * Emptying a REQUIRED dimension must not commit anything.
 *
 * The alternative considered was refusing to let focus leave the field, which
 * is a keyboard trap (WCAG 2.1.2) and fights anyone who clears a box in order
 * to retype it. Withholding the write gets the same guarantee -- no accidental
 * zero can reach the tree -- without taking the keyboard hostage.
 */
// The panel renders a MaterialPicker, which fetches the material catalog.
beforeAll(serveData);

describe('an emptied required dimension', () => {
  it('writes nothing when the box is cleared', () => {
    const onChange = vi.fn();
    render(onChange);
    const radius = screen.getByLabelText('Radius') as HTMLInputElement;

    fireEvent.focus(radius);
    fireEvent.change(radius, { target: { value: '' } });

    // The old behavior coerced this to 0 and handed it to the tree.
    expect(onChange).not.toHaveBeenCalled();
  });

  it('still writes a real value typed into the same box', () => {
    const onChange = vi.fn();
    render(onChange);
    const radius = screen.getByLabelText('Radius') as HTMLInputElement;

    fireEvent.focus(radius);
    fireEvent.change(radius, { target: { value: '' } });
    fireEvent.change(radius, { target: { value: '2' } });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![0]).toHaveProperty('outerRadius');
  });

  it('still lets a DELIBERATE zero through, for the run gate to refuse', () => {
    // Clearing is an accident; typing 0 is a statement. The gate names it and
    // blocks the flight, so it does not need to be forbidden at the keystroke.
    const onChange = vi.fn();
    render(onChange);
    const radius = screen.getByLabelText('Radius') as HTMLInputElement;

    fireEvent.focus(radius);
    fireEvent.change(radius, { target: { value: '0' } });

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
