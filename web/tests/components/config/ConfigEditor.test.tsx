// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';

import { ConfigEditor } from '../../../src/components/config/ConfigEditor';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { useWorkspaceStore } from '../../../src/state/store';

const st = () => useWorkspaceStore.getState();
const box = () => screen.getByRole('textbox', { name: /rename/i }) as HTMLInputElement;

/** One key at a time, each appended to whatever the controlled box now shows. */
function typeKeys(text: string) {
  for (const ch of text) fireEvent.change(box(), { target: { value: box().value + ch } });
}

/**
 * The name box is controlled by the store, so what the store keeps between
 * keystrokes is what the next keystroke is appended to.
 */
describe('ConfigEditor name', () => {
  beforeEach(() => {
    st().resetWorkspace();
    st().setConfigsTab('motors');
  });

  it('keeps a space typed between two words', () => {
    renderWithProviders(<ConfigEditor />);
    typeKeys('A B');
    expect(box().value).toBe('A B');
    fireEvent.blur(box());
    expect(st().configs[0]!.name).toBe('A B');
  });

  it('trims the name when the field loses focus', () => {
    renderWithProviders(<ConfigEditor />);
    fireEvent.change(box(), { target: { value: '  Two stage  ' } });
    fireEvent.blur(box());
    expect(st().configs[0]!.name).toBe('Two stage');
  });

  it('trims the name on Enter', () => {
    renderWithProviders(<ConfigEditor />);
    fireEvent.change(box(), { target: { value: 'Contest ' } });
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(st().configs[0]!.name).toBe('Contest');
  });

  it('stores a blank name as unnamed', () => {
    renderWithProviders(<ConfigEditor />);
    fireEvent.change(box(), { target: { value: '   ' } });
    fireEvent.blur(box());
    expect(st().configs[0]!.name).toBeNull();
  });
});
