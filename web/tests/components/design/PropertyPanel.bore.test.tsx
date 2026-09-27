// @vitest-environment jsdom
import { beforeAll, describe, it, expect, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { PropertyPanel } from '../../../src/components/design/PropertyPanel';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { serveData } from '../../testing/serveData';
import type { ComponentNode } from '../../../src/engine/openRocketEngine';

/**
 * The tube dimensions as the panel now states them: an outer DIAMETER, an
 * inner diameter, and the wall between them.
 *
 * Two different translations are under test and they run opposite ways. The
 * outer diameter is a stored radius doubled for display and halved on the way
 * back in, so the box and the node hold different numbers for the same
 * dimension. The inner diameter is not stored at all: it is read from the
 * outer radius and the wall, and typing one writes the WALL, which is the only
 * one of the three the `.ork` and the kernel actually carry.
 */
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

const box = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

// The panel renders a MaterialPicker, which fetches the material catalog.
beforeAll(serveData);

describe('a tube states its bore', () => {
  it('shows the outer dimension as a diameter', () => {
    render(vi.fn());
    // 13 mm of stored radius is a 26 mm tube, which is what a tube is called.
    expect(box('Diameter').value).toBe('2.6');
  });

  it('shows the bore the outer radius and the wall leave', () => {
    render(vi.fn());
    // 26 mm across, 0.5 mm of wall each side: 25 mm of usable bore. Nothing in
    // the node says 25; it is the pair of the other two.
    expect(box('Inner diameter').value).toBe('2.5');
  });

  it('writes the WALL when the bore is typed, and leaves the outside alone', () => {
    const onChange = vi.fn();
    render(onChange);

    fireEvent.change(box('Inner diameter'), { target: { value: '2' } });

    // A 20 mm bore in a 26 mm tube is a 3 mm wall. The outer radius is not in
    // the patch at all: what a tube slides into is already decided.
    const patch = onChange.mock.calls[0]![0] as { thickness: number };
    expect(Object.keys(patch)).toEqual(['thickness']);
    expect(patch.thickness).toBeCloseTo(0.003, 9);
  });

  it('will not let the bore swallow the wall', () => {
    const onChange = vi.fn();
    render(onChange);

    fireEvent.change(box('Inner diameter'), { target: { value: '5' } });

    // A bore wider than the tube is not a tube. Clamped at the outer diameter,
    // which is a zero wall - already marked as degenerate on its own row -
    // rather than a NEGATIVE one, which would flow into the mass, the mesh and
    // the .ork as a number no consumer checks for.
    const patch = onChange.mock.calls[0]![0] as { thickness: number };
    expect(patch.thickness).toBeCloseTo(0, 9);
    expect(patch.thickness).toBeGreaterThanOrEqual(0);
  });

  it('halves a typed outer diameter back into the stored radius', () => {
    const onChange = vi.fn();
    render(onChange);

    fireEvent.change(box('Diameter'), { target: { value: '5' } });

    expect(onChange).toHaveBeenCalledWith({ outerRadius: 0.025 });
  });
});

/**
 * A control that cannot do anything must not be offered.
 *
 * `Transition.isClipped()` returns false outright for a shape that is not
 * clippable, so on a conical or ogive transition the clipped flag is read by
 * nothing: not the kernel, not the schematic, not the 3D build. The shape
 * parameter has been filtered this way since it was added; the clipped flag
 * arrived without the same guard.
 */
const transition = (shape: string): ComponentNode =>
  ({
    id: 'tr',
    type: 'transition',
    name: 'Transition',
    shape,
    length: 0.05,
    foreRadius: 0.013,
    aftRadius: 0.019,
    thickness: 0.0005,
  }) as unknown as ComponentNode;

describe('the clipped-profile flag', () => {
  const render = (shape: string) =>
    renderWithProviders(
      <PropertyPanel node={transition(shape)} onChange={() => {}} onRemove={() => {}} canRemove isFirstStage={false} />,
    );

  it('is offered on a shape that can be clipped', () => {
    render('ellipsoid');
    expect(screen.queryByLabelText('Clipped profile')).not.toBeNull();
  });

  it('is not offered on one that cannot', () => {
    render('conical');
    expect(screen.queryByLabelText('Clipped profile')).toBeNull();
  });
});

/**
 * A filled part has no wall and no bore, so neither row is offered: the
 * desktop greys them out, and leaving them here would let you type a
 * thickness the kernel is ignoring.
 */
describe('the filled flag', () => {
  const tube = (filled: boolean) =>
    ({
      id: 'bt',
      type: 'bodytube',
      name: 'Body tube',
      length: 0.2,
      outerRadius: 0.013,
      thickness: 0.0005,
      filled,
    }) as unknown as ComponentNode;

  const render = (filled: boolean) =>
    renderWithProviders(
      <PropertyPanel node={tube(filled)} onChange={() => {}} onRemove={() => {}} canRemove isFirstStage={false} />,
    );

  it('offers the wall and the bore on a hollow tube', () => {
    render(false);
    expect(screen.queryByLabelText('Thickness')).not.toBeNull();
    expect(screen.queryByLabelText('Inner diameter')).not.toBeNull();
  });

  it('drops both once the part is solid', () => {
    render(true);
    expect(screen.queryByLabelText('Thickness')).toBeNull();
    expect(screen.queryByLabelText('Inner diameter')).toBeNull();
    expect(screen.queryByLabelText('Filled')).not.toBeNull();
  });
});
