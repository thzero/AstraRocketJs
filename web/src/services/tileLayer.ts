import type { TileSourceId } from './slippyMap';

/**
 * Which tile layer the app draws, for this session.
 *
 * Shared by the launch-site map and the ground track rather than remembered
 * twice, because it is one question about how a person reads the ground, not a
 * per-view setting: somebody who switched to the street layer to find the road
 * in wants the road in on both surfaces.
 *
 * Not a stored preference, for the reason the site map gave when it owned this:
 * it is switched freely while looking at one question, and a settings row for
 * it would be a row nobody goes looking for. Module-level so opening a second
 * map does not put it back to imagery.
 */
let current: TileSourceId = 'satellite';

export const tileLayer = (): TileSourceId => current;

export const rememberTileLayer = (id: TileSourceId): void => {
  current = id;
};

/**
 * Whether the results views draw imagery at all, for this session.
 *
 * Separate from WHICH layer: "satellite or street" is one question for the
 * whole app, "map or bare plot" belongs to the views that can be read either
 * way. Behind a function for the same reason the layer is - a component
 * assigning to a module-level object directly is what `react-hooks/immutability`
 * exists to catch.
 *
 * OFF until asked for. The ground track and the 3D path are measurements that
 * stand on their own - the range rings and the trajectory do not depend on a
 * picture - so opening Results should not reach out to somebody else's tile
 * servers for scenery nobody asked to see. The launch-site map is the other way
 * round and draws imagery by default, because there the picture IS the answer:
 * it exists to show you whether the coordinates are the field you meant.
 */
let ground = false;

export const groundImagery = (): boolean => ground;

export const rememberGroundImagery = (on: boolean): void => {
  ground = on;
};
