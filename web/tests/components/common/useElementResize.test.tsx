// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRef } from 'react';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { useElementResize } from '../../../src/components/common/useElementResize';

function Probe({ onResize }: { onResize: (w: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useElementResize(ref, (rect) => onResize(rect.width));
  return <div ref={ref} />;
}

afterEach(() => vi.unstubAllGlobals());

describe('useElementResize', () => {
  it('does nothing, rather than throwing, where there is no ResizeObserver', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    expect(() => renderWithProviders(<Probe onResize={() => {}} />)).not.toThrow();
  });

  it('reports the content box and disconnects on unmount', () => {
    const disconnect = vi.fn();
    let fire: (w: number) => void = () => {};
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: ResizeObserverCallback) {
          fire = (w) => cb([{ contentRect: { width: w, height: 10 } } as ResizeObserverEntry], this as never);
        }
        observe() {}
        disconnect = disconnect;
      },
    );
    const seen: number[] = [];
    const { unmount } = renderWithProviders(<Probe onResize={(w) => seen.push(w)} />);
    fire(320);
    expect(seen).toEqual([320]);
    unmount();
    expect(disconnect).toHaveBeenCalled();
  });
});
