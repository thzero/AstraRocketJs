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
