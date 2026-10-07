// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { LatLonRows } from '../../../src/components/sim/LatLonRows';
import { renderWithProviders } from '../../testing/renderWithProviders';

/** The text beside a field: its unit, which carries the hemisphere. */
const unitOf = (label: string) => screen.getByLabelText(label).closest('label')!.textContent;

describe('LatLonRows', () => {
  it('names the hemisphere the typed sign puts the site in', () => {
    renderWithProviders(<LatLonRows latitudeDeg={-33.9} longitudeDeg={-105} onChange={() => {}} />);
    expect(unitOf('Latitude')).toMatch(/° S$/);
    expect(unitOf('Longitude')).toMatch(/° W$/);
  });

  it('reads north and east for positive values', () => {
    renderWithProviders(<LatLonRows latitudeDeg={39.7} longitudeDeg={105} onChange={() => {}} />);
    expect(unitOf('Latitude')).toMatch(/° N$/);
    expect(unitOf('Longitude')).toMatch(/° E$/);
  });

  it('claims no hemisphere for an empty field', () => {
    renderWithProviders(<LatLonRows latitudeDeg={null} longitudeDeg={undefined} onChange={() => {}} />);
    expect(unitOf('Latitude')).toMatch(/°$/);
    expect(unitOf('Longitude')).toMatch(/°$/);
  });
});
