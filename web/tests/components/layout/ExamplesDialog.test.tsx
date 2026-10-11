// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { ExampleList } from '../../../src/components/layout/ExamplesDialog';

const loadExampleIndex = vi.fn();
vi.mock('../../../src/services/storage/exampleLibrary', () => ({
  loadExampleIndex: () => loadExampleIndex(),
}));

/**
 * A failed index fetch offers a retry. Offline at first open, the list would
 * otherwise stay dead until the dialog is closed and opened again.
 */
describe('ExampleList after a failed index fetch', () => {
  it('shows the failure with a retry that loads the list', async () => {
    loadExampleIndex.mockRejectedValueOnce(new Error('offline'));
    loadExampleIndex.mockResolvedValueOnce([
      { id: 'a', file: 'a.ork', name: 'A simple model rocket', description: null, bytes: 1 },
    ]);
    renderWithProviders(<ExampleList onClose={() => {}} />);

    expect((await screen.findByRole('alert')).textContent).toMatch(/could not be loaded/);
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    await screen.findByRole('button', { name: /A simple model rocket/ });
    expect(loadExampleIndex).toHaveBeenCalledTimes(2);
  });
});
