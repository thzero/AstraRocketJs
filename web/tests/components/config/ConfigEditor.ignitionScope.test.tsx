// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { ConfigEditor } from '../../../src/components/config/ConfigEditor';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { useWorkspaceStore } from '../../../src/state/store';
import { findMounts } from '../../../src/services/design/treeEdit';

const st = () => useWorkspaceStore.getState();
const mountId = () => findMounts(st().tree)[0]!.id as string;
const radio = (name: string) => screen.getByRole('radio', { name }) as HTMLInputElement;

/**
 * The ignition scope belongs to the configuration it was picked in.
 *
 * Desktop asks it afresh each time the ignition dialog opens, starting on this
 * configuration for a mount with a motor (IgnitionSelectionDialog), so a scope
 * picked in one configuration must not carry into the next one edited.
 */
describe('ConfigEditor ignition scope', () => {
  beforeEach(() => {
    st().resetWorkspace();
    st().setConfigsTab('motors');
  });

  it('starts on this configuration again when another one is edited', () => {
    st().addConfig();
    const second = st().selectedConfigId!;
    const first = st().configs.find((c) => c.id !== second)!.id;
    renderWithProviders(<ConfigEditor />);
    fireEvent.click(radio('All configurations'));
    expect(radio('All configurations').checked).toBe(true);

    act(() => st().setSelectedConfigId(first));
    expect(radio('This configuration').checked).toBe(true);
  });

  it('applies the ignition as it stands to every configuration, then has nothing left to apply', () => {
    st().addConfig();
    const second = st().selectedConfigId!;
    st().setMountIgnition(second, mountId(), 'launch', 1);
    st().commitEdit();
    renderWithProviders(<ConfigEditor />);
    fireEvent.click(radio('All configurations'));
    const apply = screen.getByRole('button', { name: 'Apply to all configurations' }) as HTMLButtonElement;
    expect(apply.disabled).toBe(false);

    fireEvent.click(apply);
    for (const c of st().configs)
      expect(c.motors[mountId()]).toMatchObject({ ignitionEvent: 'launch', ignitionDelay: 1 });
    expect(apply.disabled).toBe(true);
  });
});
