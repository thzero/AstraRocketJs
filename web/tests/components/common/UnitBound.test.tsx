// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders, seedSettings } from '../../testing/renderWithProviders';
import { UnitBound } from '../../../src/components/common/UnitBound';

describe('UnitBound', () => {
  beforeEach(() => localStorage.clear());

  it('reads the typed bound in the user unit and reports SI', () => {
    seedSettings({ units: { length: 'in' } });
    const onChange = vi.fn();
    renderWithProviders(<UnitBound quantity="length" value={null} onChange={onChange} ariaLabel="OD from" />);
    const el = screen.getByLabelText('OD from');
    fireEvent.focus(el);
    fireEvent.change(el, { target: { value: '1' } });
    expect(onChange).toHaveBeenLastCalledWith(0.0254);
  });

  it('is no bound when emptied', () => {
    const onChange = vi.fn();
    renderWithProviders(<UnitBound quantity="length" value={0.03} onChange={onChange} ariaLabel="OD to" />);
    const el = screen.getByLabelText('OD to');
    fireEvent.focus(el);
    fireEvent.change(el, { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});
