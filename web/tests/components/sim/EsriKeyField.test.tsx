// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EsriKeyField } from '../../../src/components/sim/EsriKeyField';
import { TileLayerButtons } from '../../../src/components/common/map/MapParts';
import { esriKeyStore } from '../../../src/services/map/esriKey';
import { useHelpStore } from '../../../src/state/helpStore';
import i18n from '../../../src/i18n';

afterEach(cleanup);

describe('the Esri key field', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('saves the key when it loses focus', () => {
    render(<EsriKeyField />);
    const input = screen.getByLabelText(i18n.t('map.keyLabel'));
    fireEvent.change(input, { target: { value: 'test-key' } });
    fireEvent.blur(input);
    expect(esriKeyStore.read()).toBe('test-key');
  });

  /** Settings closing with Escape removes the field with no blur. */
  it('saves the key when the field goes away before it loses focus', () => {
    const { unmount } = render(<EsriKeyField />);
    fireEvent.change(screen.getByLabelText(i18n.t('map.keyLabel')), { target: { value: 'test-key' } });
    unmount();
    expect(esriKeyStore.read()).toBe('test-key');
  });

  /** Another tab may have saved a key since this field mounted. */
  it('writes nothing when the field was not edited', () => {
    const { unmount } = render(<EsriKeyField />);
    esriKeyStore.write('test-key-other-tab');
    fireEvent.blur(screen.getByLabelText(i18n.t('map.keyLabel')));
    unmount();
    expect(esriKeyStore.read()).toBe('test-key-other-tab');
  });
});

describe('the note under a map’s layer buttons', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const LAYERS = [
    { id: 'none', labelKey: 'map.none' },
    { id: 'satellite', labelKey: 'map.satellite' },
    { id: 'street', labelKey: 'map.street' },
  ] as const;
  const nag = () => screen.queryByText(i18n.t('map.keyNag'));

  it('suggests a key of the user’s own on every tile layer while there is none', () => {
    const { rerender } = render(<TileLayerButtons layers={LAYERS} value="satellite" onPick={() => {}} />);
    expect(nag()).not.toBeNull();
    rerender(<TileLayerButtons layers={LAYERS} value="street" onPick={() => {}} />);
    expect(nag()).not.toBeNull();
  });

  it('goes away once a key is saved, here or in another tab', () => {
    render(<TileLayerButtons layers={LAYERS} value="satellite" onPick={() => {}} />);
    act(() => {
      esriKeyStore.write('test-key');
    });
    expect(nag()).toBeNull();
  });

  it('opens Help on the section that says how to get a key', () => {
    render(<TileLayerButtons layers={LAYERS} value="street" onPick={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: i18n.t('map.keyHelp') }));
    expect(useHelpStore.getState().page).toBe('settings#esri-key');
    act(() => useHelpStore.getState().closeHelp());
  });

  it('is not shown with no imagery picked', () => {
    render(<TileLayerButtons layers={LAYERS} value="none" onPick={() => {}} />);
    expect(nag()).toBeNull();
  });
});
