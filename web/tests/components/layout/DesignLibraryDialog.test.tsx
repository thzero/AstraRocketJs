// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { DesignLibraryDialog } from '../../../src/components/layout/DesignLibraryDialog';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { useWorkspaceStore } from '../../../src/state/store';

const designs = [
  { id: 'a', name: 'Alpha', updatedAt: 1 },
  { id: 'b', name: 'Bravo', updatedAt: 2 },
];

beforeEach(() => {
  useWorkspaceStore.setState({
    designs,
    activeDesignId: null,
    err: null,
    refreshDesigns: async () => {},
  } as never);
});

describe('DesignLibraryDialog rows', () => {
  it("names each row's Rename and Delete after the design they act on", () => {
    renderWithProviders(<DesignLibraryDialog onClose={() => {}} />);
    expect(screen.getByRole('button', { name: 'Rename Alpha' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete Bravo' })).toBeTruthy();
  });

  it('reports a design that fails to open instead of failing silently', async () => {
    useWorkspaceStore.setState({ openDesign: async () => Promise.reject(new Error('read refused')) } as never);
    renderWithProviders(<DesignLibraryDialog onClose={() => {}} />);
    fireEvent.click(screen.getByText('Alpha'));
    await waitFor(() => expect(useWorkspaceStore.getState().err).toContain('read refused'));
  });
});
