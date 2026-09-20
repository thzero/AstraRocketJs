/**
 * Workbench navigation, on two independent axes.
 *
 * `Tab` is what the whole workbench is doing, and it reads the same at every
 * width: Design changes geometry, Simulations manages the runs over it, Results
 * reads one back. Each tab gets its own column layout (see App.tsx).
 *
 * `DesignPane` is a PHONE concern and nothing more. The Design tab wants to show
 * the stats strip and the drawing together, which it does at lg+; a phone has
 * room for one, so below that breakpoint this picks which. Keeping it off `Tab`
 * is what lets one tab value drive both layouts — it used to be two top-level
 * tabs ('build' / 'sketch'), which forced every desktop pane rule to carry an
 * `lg:` override undoing a split that only ever mattered on a phone.
 */
export type Tab = 'design' | 'sim' | 'results';

export type DesignPane = 'stats' | 'sketch';

/**
 * What the center pane shows. Lives here, beside `Tab`, because the store
 * keeps the two in step (`showing`, `setTab`): it used to be declared in
 * `components/canvas/ViewToggle.tsx`, so the state layer imported a React
 * component module for a type and a one-line predicate. The toggle re-exports
 * both, so its importers are unchanged.
 */
export type ViewMode = '2d' | '3d' | 'drag' | 'flight' | 'path' | 'ground';
/** Views that read the design itself — the Design tab's switch. */
export const DESIGN_VIEWS: readonly ViewMode[] = ['2d', '3d', 'drag'];
/** Views that read a flight result — the Results tab's switch. */
export const RESULT_VIEWS: readonly ViewMode[] = ['flight', 'path', 'ground'];

/** True for a view that reads a flight result rather than the design itself. */
export const isResultView = (view: ViewMode): boolean => RESULT_VIEWS.includes(view);
