/**
 * Workbench navigation, on two independent axes.
 *
 * `Tab` is what the whole workbench is doing, and it reads the same at every
 * width: Design changes geometry, Configurations holds the motor loadouts the
 * runs fly, Simulations manages the runs over it, Results reads one back. Each tab gets its own column layout (see App.tsx).
 *
 * `DesignPane` is a PHONE concern and nothing more. The Design tab wants to show
 * the stats strip and the drawing together, which it does at lg+; a phone has
 * room for one, so below that breakpoint this picks which. Keeping it off `Tab` is
 * what lets one tab value drive both layouts: as a top-level tab it would force
 * every desktop pane rule to carry an `lg:` override undoing a split that only
 * matters on a phone.
 */
export type Tab = 'design' | 'configs' | 'sim' | 'results';

export type DesignPane = 'stats' | 'sketch';

/**
 * Which part of a flight configuration the Configurations tab is showing.
 *
 * The desktop's own split: a configuration says which motors fly, when the
 * recovery devices open and when each booster lets go, and those are different
 * tables over the same rows.
 */
export type ConfigsTab = 'motors' | 'recovery' | 'separation';

/**
 * What the center pane shows. Lives here, beside `Tab`, because the store keeps the
 * two in step (`showing`, `setTab`); declared in the toggle instead, the state
 * layer would import a React component module for a type and a one-line predicate.
 * The toggle re-exports both.
 */
export type ViewMode = '2d' | '3d' | 'drag' | 'flight' | 'path' | 'ground' | 'environment';
/** Views that read the design itself — the Design tab's switch. */
export const DESIGN_VIEWS: readonly ViewMode[] = ['2d', '3d', 'drag'];
/** Views that read a flight result — the Results tab's switch. */
export const RESULT_VIEWS: readonly ViewMode[] = ['flight', 'path', 'ground', 'environment'];

/** True for a view that reads a flight result rather than the design itself. */
export const isResultView = (view: ViewMode): boolean => RESULT_VIEWS.includes(view);
