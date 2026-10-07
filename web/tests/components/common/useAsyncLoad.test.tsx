// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useAsyncLoad } from '../../../src/components/common/useAsyncLoad';

function Probe({
  load,
  k,
  refresh,
  onLoaded,
}: {
  load: () => Promise<string>;
  k: string;
  refresh?: number;
  onLoaded?: (d: string) => void;
}) {
  const r = useAsyncLoad(load, k, { refresh, onLoaded });
  return (
    <>
      <p>{r.loading ? 'loading' : r.error ? `error:${r.error}` : `data:${r.data}`}</p>
      <button onClick={r.retry}>retry</button>
    </>
  );
}

// Plain `render`: the hook needs no providers, and `renderWithProviders`'s
// rerender would drop its wrapper and remount the probe.
afterEach(cleanup);

const flush = () => act(async () => {});

describe('useAsyncLoad', () => {
  it('loads, then reports the data and calls onLoaded', async () => {
    const onLoaded = vi.fn();
    render(<Probe k="a" load={() => Promise.resolve('x')} onLoaded={onLoaded} />);
    expect(screen.getByText('loading')).toBeTruthy();
    await flush();
    expect(screen.getByText('data:x')).toBeTruthy();
    expect(onLoaded).toHaveBeenCalledWith('x');
  });

  it('reports a failure, and loads again on retry', async () => {
    let fail = true;
    render(<Probe k="a" load={() => (fail ? Promise.reject(new Error('offline')) : Promise.resolve('ok'))} />);
    await flush();
    expect(screen.getByText('error:offline')).toBeTruthy();
    fail = false;
    fireEvent.click(screen.getByText('retry'));
    expect(screen.getByText('loading')).toBeTruthy();
    await flush();
    expect(screen.getByText('data:ok')).toBeTruthy();
  });

  it('shows loading for a new key, but keeps the data on screen through a refresh', async () => {
    const { rerender } = render(<Probe k="a" refresh={0} load={() => Promise.resolve('a1')} />);
    await flush();
    // Held open, so the old data can be seen standing while the reload runs.
    let release: (v: string) => void = () => {};
    const pending = new Promise<string>((r) => (release = r));
    rerender(<Probe k="a" refresh={1} load={() => pending} />);
    expect(screen.getByText('data:a1')).toBeTruthy();
    await act(async () => release('a2'));
    expect(screen.getByText('data:a2')).toBeTruthy();
    rerender(<Probe k="b" refresh={1} load={() => Promise.resolve('b1')} />);
    expect(screen.getByText('loading')).toBeTruthy();
    await flush();
    expect(screen.getByText('data:b1')).toBeTruthy();
  });
});
