// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { PropertyPanel } from '../../../src/components/design/PropertyPanel';
import { renderWithProviders, seedSettings } from '../../testing/renderWithProviders';
import { serveData } from '../../testing/serveData';
import { unitScope } from '../../../src/prefs/units';
import type { ComponentNode } from '../../../src/engine/openRocketEngine';

beforeAll(serveData);

const chute = (): ComponentNode =>
  ({
    id: 'c',
    type: 'parachute',
    name: 'Main',
    diameter: 0.5,
    cd: 0.8,
    deployEvent: 'altitude',
    deployAltitude: 150,
  }) as unknown as ComponentNode;

/**
 * A finite ENTRY is not a finite stored value.
 *
 * `NumberInput.parseFieldValue` refuses a non-finite entry, so Infinity cannot
 * be typed. But the box holds display units and the node holds SI, and the
 * conversion between them overflows on its own wherever the display unit is the
 * larger of the two: 1e306 km is 1e309 m, which is Infinity. That reached the
 * node, was persisted, and went out to the `.ork` as `Infinity` — which the
 * reader takes back as 0, so the field showed a number the geometry never had.
 */
describe('a dimension whose unit conversion overflows', () => {
  // Kilometers on this one field, which is the whole point: in meters (the
  // default) the conversion is a multiply by one and cannot overflow.
  beforeEach(() => seedSettings({ unitOverrides: { [unitScope('prop', 'parachute', 'deployAltitude')]: 'km' } }));

  const render = (onChange: (p: Partial<ComponentNode>) => void) =>
    renderWithProviders(
      <PropertyPanel node={chute()} onChange={onChange} onRemove={() => {}} canRemove isFirstStage={false} />,
    );

  it('writes nothing', () => {
    const onChange = vi.fn();
    render(onChange);
    const box = screen.getByLabelText('Deploy altitude (AGL)') as HTMLInputElement;

    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: '1e306' } });

    expect(onChange).not.toHaveBeenCalled();
  });

  it('still writes an ordinary value in the same box', () => {
    const onChange = vi.fn();
    render(onChange);
    const box = screen.getByLabelText('Deploy altitude (AGL)') as HTMLInputElement;

    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: '1e306' } });
    fireEvent.change(box, { target: { value: '0.2' } });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![0]).toEqual({ deployAltitude: 200 });
  });
});
