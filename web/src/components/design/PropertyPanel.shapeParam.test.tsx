// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { PropertyPanel } from './PropertyPanel';
import type { ComponentNode } from '../../engine/openRocketEngine';

/**
 * The Shape parameter field, which is the newest thing in the panel and was
 * shipped with nothing testing it.
 *
 * `shapeParameter` was READ by the mesh, the report, the schematic, the 3D
 * view and both .ork paths, and written by nothing: a power/haack/ogive nose
 * imported from a file carried a parameter that changes its whole profile,
 * that the user could see the effect of and never edit, and that a round trip
 * froze at whatever the file said. `shapeUsesParameter` and `shapeParamMax`
 * were both exported and unit-tested in `tree/shapeProfile` with zero
 * production callers - so the helpers were proven and the WIRING was not, and
 * the wiring is the whole of this feature. Neither `PropertyPanel.scopes` nor
 * `PropertyPanel.required` renders anything.
 */

const LABEL = 'Shape parameter';

function panel(node: Partial<ComponentNode>, onChange = vi.fn()) {
  renderWithProviders(<PropertyPanel node={node as ComponentNode} onChange={onChange} onRemove={() => {}} />);
  return onChange;
}

/** The spinbutton itself, so the `max` attribute can be read off it. */
const field = () => screen.getByRole('spinbutton', { name: LABEL }) as HTMLInputElement;

describe('the field appears only for shapes that use a parameter', () => {
  it.each(['ogive', 'power', 'parabolic', 'haack'])('shows it for a %s nose cone', (shape) => {
    panel({ type: 'nosecone', shape, length: 0.1, aftRadius: 0.012 });
    expect(screen.queryByRole('spinbutton', { name: LABEL })).not.toBeNull();
  });

  it.each(['conical', 'ellipsoid'])('hides it for a %s nose cone', (shape) => {
    panel({ type: 'nosecone', shape, length: 0.1, aftRadius: 0.012 });
    expect(screen.queryByRole('spinbutton', { name: LABEL })).toBeNull();
  });

  it('shows it for a power transition and hides it for a conical one', () => {
    panel({ type: 'transition', shape: 'power', length: 0.05, foreRadius: 0.012, aftRadius: 0.02 });
    expect(screen.queryByRole('spinbutton', { name: LABEL })).not.toBeNull();
    screen.getByRole('spinbutton', { name: 'Length' }); // the panel really rendered
  });

  it('hides it for a conical transition', () => {
    panel({ type: 'transition', shape: 'conical', length: 0.05, foreRadius: 0.012, aftRadius: 0.02 });
    expect(screen.queryByRole('spinbutton', { name: LABEL })).toBeNull();
  });

  it('assumes the per-type default shape when the node declares none', () => {
    // The two defaults differ, and getting them the wrong way round would show
    // the field on exactly the parts that cannot use it.
    panel({ type: 'nosecone', length: 0.1, aftRadius: 0.012 }); // -> ogive, uses one
    expect(screen.queryByRole('spinbutton', { name: LABEL })).not.toBeNull();
  });

  it('assumes conical for a transition that declares no shape', () => {
    panel({ type: 'transition', length: 0.05, foreRadius: 0.012, aftRadius: 0.02 });
    expect(screen.queryByRole('spinbutton', { name: LABEL })).toBeNull();
  });
});

describe('the ceiling is the shape-dependent one the kernel enforces', () => {
  it('tops an ogive out at 1', () => {
    panel({ type: 'nosecone', shape: 'ogive', length: 0.1, aftRadius: 0.012, shapeParameter: 1 });
    expect(field().max).toBe('1');
  });

  it('tops a haack out at LV-Haack, 1/3', () => {
    // Shape.maxParameter() in the kernel. A haack at 1 is not a shape the
    // desktop can represent, so a design edited past it would not round-trip.
    panel({ type: 'nosecone', shape: 'haack', length: 0.1, aftRadius: 0.012, shapeParameter: 0.3 });
    expect(Number(field().max)).toBeCloseTo(1 / 3, 12);
  });

  it('clamps a typed value down to the shape ceiling', () => {
    const onChange = panel({
      type: 'nosecone',
      shape: 'haack',
      length: 0.1,
      aftRadius: 0.012,
      shapeParameter: 0.3,
    });
    fireEvent.change(field(), { target: { value: '0.9' } });
    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls.at(-1)![0]).toEqual({ shapeParameter: 1 / 3 });
  });

  it('clamps a negative value up to zero', () => {
    const onChange = panel({
      type: 'nosecone',
      shape: 'power',
      length: 0.1,
      aftRadius: 0.012,
      shapeParameter: 0.5,
    });
    fireEvent.change(field(), { target: { value: '-2' } });
    expect(onChange.mock.calls.at(-1)![0]).toEqual({ shapeParameter: 0 });
  });

  it('passes an in-range value straight through', () => {
    const onChange = panel({
      type: 'nosecone',
      shape: 'ogive',
      length: 0.1,
      aftRadius: 0.012,
      shapeParameter: 1,
    });
    fireEvent.change(field(), { target: { value: '0.75' } });
    expect(onChange.mock.calls.at(-1)![0]).toEqual({ shapeParameter: 0.75 });
  });

  it('leaves an ordinary number field unbounded above', () => {
    // `paramMax` is undefined for every other key, so the clamp must not leak
    // onto, say, Length - which would silently cap a 2 m airframe at 1 m.
    panel({ type: 'nosecone', shape: 'ogive', length: 0.1, aftRadius: 0.012 });
    expect((screen.getByRole('spinbutton', { name: 'Length' }) as HTMLInputElement).max).toBe('');
  });
});
