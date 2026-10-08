// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { FreeformFinActions } from '../../../src/components/design/FreeformFinActions';
import { renderWithProviders } from '../../testing/renderWithProviders';
import * as saveFile from '../../../src/services/files/saveFile';
import { useWorkspaceStore } from '../../../src/state/store';
import type { ComponentNode } from '../../../src/engine/openRocketEngine';

const fin = {
  type: 'freeformfinset',
  id: 'ff',
  name: 'Fin set',
  points: [
    [0, 0],
    [0.04, 0.03],
    [0.06, 0],
  ],
} as unknown as ComponentNode;

afterEach(() => vi.restoreAllMocks());

/**
 * The fin outline download is named the way every export is (exportFilename):
 * rocket, part, what it is. A bare "Fin_set.csv" would say nothing about which
 * rocket, beside "Bertha-aero-table.csv" in the same downloads folder.
 */
describe('FreeformFinActions', () => {
  it('names the CSV after the rocket and the fin', () => {
    useWorkspaceStore.setState({ tree: { ...useWorkspaceStore.getState().tree, name: 'Bertha' } });
    const spy = vi.spyOn(saveFile, 'download').mockImplementation(() => {});
    renderWithProviders(<FreeformFinActions node={fin} />);
    fireEvent.click(screen.getByRole('button', { name: /Export CSV/ }));
    expect(spy.mock.calls[0]![0]).toBe('Bertha-Fin_set-points.csv');
  });
});
