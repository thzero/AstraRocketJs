// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { WorstButton } from '../../../src/components/canvas/AeroInputs';
import { renderWithProviders } from '../../testing/renderWithProviders';

/** A press of Worst always has a visible outcome, the failure included. */
describe('WorstButton', () => {
  afterEach(() => vi.restoreAllMocks());

  it('writes the worst angle into the field', () => {
    const onWorst = vi.fn();
    renderWithProviders(<WorstButton worst={() => 42.5} onWorst={onWorst} />);
    fireEvent.click(screen.getByRole('button', { name: 'Worst' }));
    expect(onWorst).toHaveBeenCalledWith(42.5);
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('says so beside the button when the kernel throws, and leaves the field alone', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const onWorst = vi.fn();
    renderWithProviders(
      <WorstButton
        worst={() => {
          throw new Error('no such method');
        }}
        onWorst={onWorst}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Worst' }));
    expect(onWorst).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).not.toBe('');
  });
});
