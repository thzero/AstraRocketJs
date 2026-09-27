// @vitest-environment jsdom
import { beforeAll, describe, it, expect, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { PropertyPanel } from '../../../src/components/design/PropertyPanel';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { serveData } from '../../testing/serveData';
import type { ComponentNode } from '../../../src/engine/openRocketEngine';

/**
 * The rows that are a second way of typing a number the part already stores:
 * OpenRocket offers all three, because they are how people actually have the
 * figure. Nothing here is a node key, so each one is checked BOTH ways round -
 * the value it shows, and the stored keys a typed value writes.
 */

const node = (o: Record<string, unknown>): ComponentNode => o as unknown as ComponentNode;

const render = (n: ComponentNode, onChange: (p: Partial<ComponentNode>) => void) =>
  renderWithProviders(
    <PropertyPanel node={n} onChange={onChange} onRemove={() => {}} canRemove isFirstStage={false} />,
  );

const box = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

beforeAll(serveData);

describe('a fin sweep as an angle', () => {
  const fin = () =>
    node({
      id: 'f',
      type: 'trapezoidfinset',
      name: 'Fins',
      finCount: 3,
      rootChord: 0.05,
      tipChord: 0.03,
      sweep: 0.02,
      height: 0.02,
      thickness: 0.003,
    });

  it('shows the angle the stored sweep makes, in degrees', () => {
    render(fin(), vi.fn());
    // 20 mm back over 20 mm of span is 45 degrees. Nothing in the node says 45.
    expect(box('Sweep angle').value).toBe('45');
  });

  it('writes the SWEEP LENGTH when an angle is typed', () => {
    const onChange = vi.fn();
    render(fin(), onChange);

    fireEvent.change(box('Sweep angle'), { target: { value: '30' } });

    const patch = onChange.mock.calls.at(-1)![0] as Record<string, number>;
    expect(Object.keys(patch)).toEqual(['sweep']);
    expect(patch['sweep']).toBeCloseTo(0.02 * Math.tan(Math.PI / 6), 9);
  });

  it('takes a negative angle, which every other numeric row refuses', () => {
    const onChange = vi.fn();
    render(fin(), onChange);

    // A forward-swept fin. The shared NumberField floors at 0, so this row has
    // to open its floor or the shape could not be entered at all.
    expect(box('Sweep angle').min).toBe('-89');
    fireEvent.change(box('Sweep angle'), { target: { value: '-45' } });

    expect((onChange.mock.calls.at(-1)![0] as Record<string, number>)['sweep']).toBeCloseTo(-0.02, 9);
  });
});

describe('a streamer by area and aspect ratio', () => {
  const streamer = () =>
    node({ id: 's', type: 'streamer', name: 'Streamer', stripLength: 0.5, stripWidth: 0.05, cd: 0.6 });

  it('shows the area in square centimeters and the ratio as a bare number', () => {
    render(streamer(), vi.fn());
    // 50 cm by 5 cm: 250 cm squared, ten times as long as it is wide.
    expect(box('Strip area').value).toBe('250');
    expect(box('Aspect ratio').value).toBe('10');
  });

  it('re-cuts both sides and keeps the ratio when the area is typed', () => {
    const onChange = vi.fn();
    render(streamer(), onChange);

    fireEvent.change(box('Strip area'), { target: { value: '1000' } });

    const patch = onChange.mock.calls.at(-1)![0] as Record<string, number>;
    // Four times the fabric at the same 10:1, so both sides double.
    expect(patch['stripWidth']).toBeCloseTo(0.1, 9);
    expect(patch['stripLength']).toBeCloseTo(1, 9);
  });

  it('re-cuts both sides and keeps the area when the ratio is typed', () => {
    const onChange = vi.fn();
    render(streamer(), onChange);

    fireEvent.change(box('Aspect ratio'), { target: { value: '40' } });

    const patch = onChange.mock.calls.at(-1)![0] as Record<string, number>;
    const w = patch['stripWidth']!;
    const l = patch['stripLength']!;
    expect(w * l).toBeCloseTo(0.025, 12);
    expect(l / w).toBeCloseTo(40, 9);
  });
});

describe('a mass component by density', () => {
  // 12 mm across the packed lump, 20 mm long, 8 g: near enough to a steel slug.
  const lump = () =>
    node({ id: 'm', type: 'masscomponent', name: 'Ballast', mass: 0.008, radius: 0.006, length: 0.02 });

  it('shows what the lump would be made of', () => {
    render(lump(), vi.fn());
    const volume = Math.PI * 0.006 ** 2 * 0.02;
    // Shown in g/cm cubed, the metric default, so kg/m cubed over a thousand.
    expect(Number(box('Approximate density').value)).toBeCloseTo(0.008 / volume / 1000, 2);
  });

  it('writes the MASS when a density is typed', () => {
    const onChange = vi.fn();
    render(lump(), onChange);

    fireEvent.change(box('Approximate density'), { target: { value: '2.7' } });

    const patch = onChange.mock.calls.at(-1)![0] as Record<string, number>;
    expect(Object.keys(patch)).toEqual(['mass']);
    // Aluminum through a 12 by 20 mm cylinder.
    expect(patch['mass']).toBeCloseTo(2700 * Math.PI * 0.006 ** 2 * 0.02, 9);
  });
});

describe('a motor cluster states its gap both ways', () => {
  const tube = (extra: Record<string, unknown> = {}) =>
    node({
      id: 'i',
      type: 'innertube',
      name: 'Motor mount',
      length: 0.07,
      outerRadius: 0.0095,
      thickness: 0.0005,
      cluster: 'double',
      clusterScale: 1.5,
      ...extra,
    });

  it('shows the multiple and the distance side by side', () => {
    render(tube(), vi.fn());
    expect(box('Cluster spacing').value).toBe('1.5');
    // Half a 19 mm diameter of air between neighbors, in the metric default.
    expect(box('Tube separation').value).toBe('0.95');
  });

  it('writes the stored SCALE when the distance is typed', () => {
    const onChange = vi.fn();
    render(tube(), onChange);

    fireEvent.change(box('Tube separation'), { target: { value: '1.9' } });

    const patch = onChange.mock.calls.at(-1)![0] as Record<string, number>;
    expect(Object.keys(patch)).toEqual(['clusterScale']);
    // A whole 19 mm diameter of air between neighbors is a scale of 2.
    expect(patch['clusterScale']).toBeCloseTo(2, 9);
  });

  it('takes a negative gap, for tubes packed into each other', () => {
    render(tube(), vi.fn());
    // One whole diameter in, where the kernel clamps the scale to zero.
    expect(box('Tube separation').min).toBe('-1.9');
  });

  it('offers no cluster rows at all on a single tube', () => {
    render(tube({ cluster: 'single' }), vi.fn());
    // All three describe where the OTHER tubes go, and there are none.
    expect(screen.queryByLabelText('Cluster spacing')).toBeNull();
    expect(screen.queryByLabelText('Tube separation')).toBeNull();
    expect(screen.queryByLabelText('Cluster rotation')).toBeNull();
  });
});
