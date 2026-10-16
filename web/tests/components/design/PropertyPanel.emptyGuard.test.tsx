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

/** A tube fin set: its length is a value the kernel cannot fly at 0, so it is required. */
const tubeFins = (): ComponentNode =>
  ({
    id: 'fins',
    type: 'tubefinset',
    name: 'Tube fins',
    finCount: 6,
    length: 0.05,
    outerRadius: 0.005,
    thickness: 0.0005,
  }) as unknown as ComponentNode;

const render = (onChange: (p: Partial<ComponentNode>) => void, node: ComponentNode = tubeFins()) =>
  renderWithProviders(
    <PropertyPanel node={node} onChange={onChange} onRemove={() => {}} canRemove isFirstStage={false} />,
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
    const box = screen.getByLabelText('Length') as HTMLInputElement;

    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: '' } });

    // Coerced to 0, an empty box would hand a zero to the tree.
    expect(onChange).not.toHaveBeenCalled();
  });

  it('still writes a real value typed into the same box', () => {
    const onChange = vi.fn();
    render(onChange);
    const box = screen.getByLabelText('Length') as HTMLInputElement;

    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: '' } });
    fireEvent.change(box, { target: { value: '2' } });

    expect(onChange).toHaveBeenCalledTimes(1);
    const written = onChange.mock.calls[0]![0] as Record<string, number>;
    expect(Object.keys(written)).toEqual(['length']);
    expect(written['length']).toBeGreaterThan(0);
  });

  it('still lets a DELIBERATE zero through, for the run gate to refuse', () => {
    // Clearing is an accident; typing 0 is a statement. The gate names it and
    // blocks the flight, so it does not need to be forbidden at the keystroke.
    const onChange = vi.fn();
    render(onChange);
    const box = screen.getByLabelText('Length') as HTMLInputElement;

    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: '0' } });

    expect(onChange).toHaveBeenCalledWith({ length: 0 });
  });

  it('does not guard an OPTIONAL dimension, where clearing means zero', () => {
    // Motor overhang 0 is flush, and clearing it is a reasonable way to say so.
    // The box is there only on a motor mount.
    const onChange = vi.fn();
    render(onChange, { ...tube(), motorMount: true } as ComponentNode);
    const overhang = screen.getByLabelText('Motor overhang') as HTMLInputElement;

    fireEvent.focus(overhang);
    fireEvent.change(overhang, { target: { value: '' } });

    expect(onChange).toHaveBeenCalledWith({ motorOverhang: 0 });
  });
});
