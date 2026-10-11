// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { useHeaderDialogs } from '../../../src/components/layout/HeaderDialogs';
import { useWorkspaceStore } from '../../../src/state/store';
import { renderWithProviders } from '../../testing/renderWithProviders';

function Harness() {
  const { open, dialogs } = useHeaderDialogs();
  return (
    <>
      <button type="button" onClick={() => open('saveAs')}>
        open save as
      </button>
      {dialogs}
    </>
  );
}

/**
 * Save As finishes by refreshing the library list, which can reject. A
 * rejection nobody handles is a save that looks as though it worked; it lands
 * in the error banner instead.
 */
describe('Save As', () => {
  const real = useWorkspaceStore.getState().saveDesignAs;
  afterEach(() => act(() => useWorkspaceStore.setState({ saveDesignAs: real, err: null })));

  it('reports a rejected save in the error banner', async () => {
    act(() =>
      useWorkspaceStore.setState({
        err: null,
        saveDesignAs: () => Promise.reject(new Error('library refused')),
      }),
    );
    renderWithProviders(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'open save as' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
    await waitFor(() => expect(useWorkspaceStore.getState().err).toContain('library refused'));
  });
});
