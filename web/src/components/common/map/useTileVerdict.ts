import { useCallback, useRef, useState } from 'react';
import type { TileSourceId } from '../../../services/map/slippyMap';
import { groundImagery, rememberGroundImagery, rememberTileLayer, tileLayer } from '../../../services/map/tileLayer';
import { TILE_FAILURES_OFFLINE, type Layer } from './mapStyle';

export type TileImagery = 'unknown' | 'ok' | 'unavailable';

/**
 * Whether tiles are getting through, and for which source.
 *
 * Carrying the source with the verdict is what makes switching layers re-ask
 * the network: the stale verdict is simply not the current source's, so it
 * reads as unknown again without an effect reaching in to clear it.
 *
 * Once a tile has loaded the source is reachable, and later failures are holes
 * in the coverage, not an outage. Only `TILE_FAILURES_OFFLINE` failures with
 * nothing loaded say the imagery is unavailable.
 *
 * Both callbacks keep the state object when the verdict is unchanged. A fresh
 * object per tile re-renders the whole map once for every tile in a
 * screenful, which over a long track stalls the tab.
 */
export function useTileVerdict(source: TileSourceId | null) {
  const [reached, setReached] = useState<{ src: TileSourceId; state: 'ok' | 'unavailable' } | null>(null);
  const errors = useRef(0);
  const imagery: TileImagery = source && reached?.src === source ? reached.state : 'unknown';

  const onTileLoad = useCallback(() => {
    errors.current = 0;
    if (!source) return;
    setReached((prev) => (prev?.src === source && prev.state === 'ok' ? prev : { src: source, state: 'ok' }));
  }, [source]);

  const onTileError = useCallback(() => {
    errors.current += 1;
    if (!source || errors.current < TILE_FAILURES_OFFLINE) return;
    setReached((prev) => (prev?.src === source && prev.state === 'ok' ? prev : { src: source, state: 'unavailable' }));
  }, [source]);

  /**
   * Drops a failed verdict and starts the count over, which is what makes
   * pressing the layer you are already on a retry rather than a button that
   * does nothing. Offline is the state a map is most often in at the field.
   */
  const retry = useCallback(() => {
    errors.current = 0;
    setReached((prev) => (prev?.state === 'unavailable' ? null : prev));
  }, []);

  return { imagery, onTileLoad, onTileError, retry };
}

/**
 * The ground imagery a flight view draws under its track: off until asked
 * for, and the None / Satellite / Street choice shared across the views for
 * the session (services/map/tileLayer.ts). `source` is null with no site to
 * center the imagery on.
 */
export function useGroundLayer(hasSite: boolean) {
  const [layer, setLayer] = useState<Layer>(() => (groundImagery() ? tileLayer() : 'off'));
  const source: TileSourceId | null = hasSite && layer !== 'off' ? layer : null;
  const verdict = useTileVerdict(source);
  const pick = (next: Layer) => {
    rememberGroundImagery(next !== 'off');
    if (next !== 'off') rememberTileLayer(next);
    verdict.retry();
    setLayer(next);
  };
  return { layer, source, pick, ...verdict };
}
