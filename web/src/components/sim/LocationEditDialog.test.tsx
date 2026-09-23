// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { LocationEditDialog } from './LocationEditDialog';
import { renderWithProviders } from '../../testing/renderWithProviders';
import type { LaunchLocation } from '../../services/launchLocationStore';

/**
 * The full location editor: name AND coordinates.
 *
 * Renaming alone was never the useful edit — the thing you most want to correct
 * about a location is a number. These cover the two jobs the dialog does (fix an
 * existing location, create one from nothing) and the guard that keeps a location the
 * store would reject from being reachable at all.
 */

const HOME: LaunchLocation = {
  id: 'home',
  name: 'Home field',
  latitudeDeg: 39.05,
  longitudeDeg: -104.8,
  launchAltitudeM: 1830,
};

const render = (location: LaunchLocation | null, takenNames: string[] = []) => {
  const onSave = vi.fn();
  const onCancel = vi.fn();
  renderWithProviders(
    <LocationEditDialog location={location} takenNames={takenNames} onSave={onSave} onCancel={onCancel} />,
  );
  return { onSave, onCancel };
};

const field = (name: string) => screen.getByLabelText(name) as HTMLInputElement;
const save = () => screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;

describe('LocationEditDialog, editing', () => {
  it('seeds every field from the location', () => {
    render(HOME);
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('Home field');
    expect(field('Latitude').value).toBe('39.05');
    expect(field('Longitude').value).toBe('-104.8');
    expect(field('Altitude').value).toBe('1830');
  });

  it('saves a corrected coordinate, keeping the location id', () => {
    // The id is what makes this an edit rather than a second location with the same
    // name — `launchLocationStore.save` replaces by id.
    const { onSave } = render(HOME);
    fireEvent.change(field('Latitude'), { target: { value: '39.1234' } });
    fireEvent.click(save());
    expect(onSave).toHaveBeenCalledWith({ ...HOME, latitudeDeg: 39.1234 });
  });

  it('saves a corrected elevation', () => {
    const { onSave } = render(HOME);
    fireEvent.change(field('Altitude'), { target: { value: '1840' } });
    fireEvent.click(save());
    expect(onSave.mock.calls[0]![0].launchAltitudeM).toBeCloseTo(1840, 6);
  });

  it('warns about a duplicate name without forbidding it', () => {
    const { onSave } = render(HOME, ['Other field']);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Other field' } });
    expect(screen.getByText(/already has this name/i)).toBeTruthy();
    // A warning, not a block: two clubs can genuinely use the same name for
    // different fields, and the id keeps them apart.
    expect(save().disabled).toBe(false);
    fireEvent.click(save());
    expect(onSave).toHaveBeenCalled();
  });
});

describe('LocationEditDialog, the map', () => {
  it('shows the location it is editing', () => {
    render(HOME);
    // Hemispheres, not signs: the readout is there to make a wrong-signed
    // longitude obvious, so it must not repeat the field's own ambiguity.
    expect(screen.getByText('39.0500° N, 104.8000° W')).toBeTruthy();
  });

  it('fills both coordinates from a click, which is how a field with no published numbers is entered', () => {
    const { onSave } = render(null);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'The club field' } });
    // Not a real place to click in jsdom, but the coordinate under the
    // pointer is what matters, and with no coordinate yet the map opens on
    // the world at 0,0 — so its center is 0,0.
    const map = screen.getByRole('group', { name: /Launch site map/ });
    fireEvent.pointerDown(map, { pointerId: 1, clientX: 160, clientY: 128 });
    fireEvent.pointerUp(map, { pointerId: 1, clientX: 160, clientY: 128 });

    expect(field('Latitude').value).toBe('0');
    expect(field('Longitude').value).toBe('0');
    // And that is a complete location: a click answers the requirement that both
    // coordinates be given, the same as typing them.
    expect(save().disabled).toBe(false);
    fireEvent.click(save());
    expect(onSave.mock.calls[0]![0]).toMatchObject({ latitudeDeg: 0, longitudeDeg: 0 });
  });

  it('moves the pin when a coordinate is typed', () => {
    render(HOME);
    fireEvent.change(field('Latitude'), { target: { value: '51.5' } });
    // The map follows the draft fields, not the saved location, so a mistyped
    // coordinate shows before anything is written.
    expect(screen.getByText('51.5000° N, 104.8000° W')).toBeTruthy();
  });
});

describe('LocationEditDialog, creating', () => {
  it('starts empty and refuses to save until it is a real place', () => {
    const { onSave } = render(null);
    expect(save().disabled).toBe(true);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'New field' } });
    // A name alone is not a location: 0°,0° is the Gulf of Guinea, not "unset", so
    // both coordinates are required rather than defaulted.
    expect(save().disabled).toBe(true);

    fireEvent.change(field('Latitude'), { target: { value: '51.5' } });
    expect(save().disabled).toBe(true);
    fireEvent.change(field('Longitude'), { target: { value: '-0.12' } });
    expect(save().disabled).toBe(false);

    fireEvent.click(save());
    // Elevation defaults to sea level, which is a real answer for a coastal
    // field rather than a guess.
    expect(onSave.mock.calls[0]![0]).toMatchObject({
      name: 'New field',
      latitudeDeg: 51.5,
      longitudeDeg: -0.12,
      launchAltitudeM: 0,
    });
    expect(onSave.mock.calls[0]![0].id).toMatch(/[0-9a-f-]{8,}/);
  });

  it('clamps a coordinate to the range the store would accept', () => {
    // `NumberInput` clamps on entry, so a latitude the store would reject
    // (`isLocation`) is unreachable rather than refused after the fact.
    const { onSave } = render(null);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Impossible' } });
    fireEvent.change(field('Latitude'), { target: { value: '120' } });
    fireEvent.change(field('Longitude'), { target: { value: '-400' } });
    fireEvent.click(save());
    expect(onSave.mock.calls[0]![0]).toMatchObject({ latitudeDeg: 90, longitudeDeg: -180 });
  });
});
