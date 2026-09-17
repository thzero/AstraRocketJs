// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { UnitChip } from './UnitChip';
import { renderWithProviders, seedSettings, readSettings } from '../../testing/renderWithProviders';
import { unitScope } from '../../prefs/units';

const SCOPE = unitScope('prop', 'nosecone', 'length');
const OTHER = unitScope('prop', 'nosecone', 'thickness');

const chip = () => screen.getByRole('combobox') as HTMLSelectElement;
const overrides = () => (readSettings().unitOverrides ?? {}) as Record<string, string>;

/**
 * The chip owns rules that live nowhere else — what it writes, and what it
 * REMOVES. Those were only ever exercised end-to-end, where a regression shows
 * up as a puzzling assertion three steps away from the cause.
 */
describe('UnitChip', () => {
  beforeEach(() => localStorage.clear());

  it('shows the preference when the field has no unit of its own', () => {
    renderWithProviders(<UnitChip quantity="length" scope={SCOPE} />);
    expect(chip().value).toBe('cm'); // the metric default
  });

  it('writes the chosen unit against its own scope, and nothing else', () => {
    seedSettings({ unitOverrides: { [OTHER]: 'mm' } });
    renderWithProviders(<UnitChip quantity="length" scope={SCOPE} />);

    fireEvent.change(chip(), { target: { value: 'in' } });

    expect(overrides()).toEqual({ [OTHER]: 'mm', [SCOPE]: 'in' });
  });

  it('REMOVES the override when the preference unit is picked back', () => {
    // The rule that keeps the layers from sticking: storing 'cm' because it
    // matches today's default would pin the field, so a later switch to
    // Imperial would skip it and it would stay marked as a deliberate choice.
    seedSettings({ unitOverrides: { [SCOPE]: 'in' } });
    renderWithProviders(<UnitChip quantity="length" scope={SCOPE} />);

    fireEvent.change(chip(), { target: { value: 'cm' } });

    expect(SCOPE in overrides()).toBe(false);
  });

  it('marks an overridden field in its accessible name, not only in color', () => {
    seedSettings({ unitOverrides: { [SCOPE]: 'in' } });
    renderWithProviders(<UnitChip quantity="length" scope={SCOPE} />);

    expect(chip().getAttribute('aria-label')).toBe('Component dimensions unit, set for this field');
    expect(chip().className).toContain('text-amber-400');
  });

  it('names a field that follows the preference without qualification', () => {
    renderWithProviders(<UnitChip quantity="length" scope={SCOPE} />);

    expect(chip().getAttribute('aria-label')).toBe('Component dimensions unit');
    expect(chip().className).toContain('text-slate-500');
  });

  it('offers only the units its quantity defines', () => {
    renderWithProviders(<UnitChip quantity="motorDimensions" scope={unitScope('motor', 'dia')} />);

    const options = [...chip().options].map((o) => o.value);
    expect(options).toEqual(['mm', 'cm', 'in']); // motor dimensions, not all lengths
  });

  it('ignores a stored unit that does not belong to its quantity', () => {
    // Scope keys carry no quantity, so a stale entry can name a unit from a
    // different group. It must fall back rather than be handed to the chip.
    seedSettings({ unitOverrides: { [SCOPE]: 'oz' } });
    renderWithProviders(<UnitChip quantity="length" scope={SCOPE} />);

    expect(chip().value).toBe('cm');
  });
});
