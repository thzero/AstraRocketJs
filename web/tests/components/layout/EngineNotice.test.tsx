// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { EngineNotice } from '../../../src/components/layout/EngineNotice';
import { useEngineStore } from '../../../src/state/engineStore';
import { renderWithProviders } from '../../testing/renderWithProviders';
import i18n from '../../../src/i18n';

const MB = 1024 * 1024;

/**
 * The live region names the step, not the byte count. The count changes every
 * tenth of a megabyte, and a polite region re-reads itself on every change.
 */
describe('EngineNotice', () => {
  const initial = useEngineStore.getState();
  afterEach(() => act(() => useEngineStore.setState(initial)));

  it('keeps the byte count out of the live region while it downloads', () => {
    act(() =>
      useEngineStore.setState({
        phase: 'loading',
        slow: false,
        status: { phase: 'downloading', loaded: 0.4 * MB, total: 2.3 * MB } as never,
      }),
    );
    renderWithProviders(<EngineNotice />);
    const live = screen.getByRole('status');
    const said = live.textContent;
    expect(said).toBe('Downloading engine…');

    act(() =>
      useEngineStore.setState({ status: { phase: 'downloading', loaded: 1.1 * MB, total: 2.3 * MB } as never }),
    );
    expect(screen.getByRole('status').textContent).toBe(said);
    // The count is still on screen for the eye.
    expect(screen.getByText(/1\.1/)).toBeTruthy();
  });

  it('says what still works once the load is stuck', () => {
    act(() => useEngineStore.setState({ phase: 'loading', slow: true, status: null }));
    renderWithProviders(<EngineNotice />);
    expect(screen.getByRole('status').textContent).toBe(`${i18n.t('engine.slow')} ${i18n.t('engine.needsIt')}`);
    expect(screen.getByRole('button')).toBeTruthy();
  });

  // Retry cannot recover a load whose only backend is the JS chunk, so the
  // banner offers the reload that can, rather than a button that does nothing.
  it('offers a reload instead of a retry when a retry cannot recover the load', () => {
    const retry = vi.fn();
    const reload = vi.fn();
    act(() =>
      useEngineStore.setState({ phase: 'failed', slow: false, status: null, needsReload: true, retry, reload }),
    );
    renderWithProviders(<EngineNotice />);
    fireEvent.click(screen.getByRole('button', { name: i18n.t('engine.reload') }));
    expect(reload).toHaveBeenCalledOnce();
    expect(retry).not.toHaveBeenCalled();
  });
});
