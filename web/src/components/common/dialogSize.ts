/**
 * Dialog widths, and the user's choice to expand one.
 *
 * Separate from the component so the size table and the persistence are
 * testable without a DOM, and so a dialog's declared width stays one token
 * rather than a Tailwind class copied into twenty files.
 */

/**
 * A dialog's declared width, named for the Tailwind token it is, so there is no
 * translation layer to get wrong. These are the widths the app already used
 * before they were centralized: `sm` through `6xl`.
 */
export type DialogSize = 'sm' | 'md' | 'lg' | '3xl' | '4xl' | '6xl';

const WIDTH: Record<DialogSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  '3xl': 'max-w-3xl',
  '4xl': 'max-w-4xl',
  '6xl': 'max-w-6xl',
};

/**
 * Just the width, for a modal surface that is not a full `Dialog`: an
 * `AlertDialog` has no scrolling body to cap, nothing to expand into, and sets
 * its own height rule.
 */
export const widthClass = (size: DialogSize): string => WIDTH[size];

/**
 * What a dialog expands TO. Not `w-screen`: the overlay keeps its padding at
 * `lg` and up, and a viewport-wide panel inside a padded overlay overflows it.
 */
const EXPANDED = 'max-w-[96vw]';

/** Height is capped whatever the width, because a tall dialog on a short window
 *  used to run off the bottom: nine of the twenty declared no max height. */
const HEIGHT = 'max-h-[85vh]';
const HEIGHT_EXPANDED = 'max-h-[94vh]';

/**
 * The panel's size classes.
 *
 * `fill` asks for a DEFINITE height rather than a maximum, because a body that
 * fills the dialog (a map, a chart) is a `flex-1` child, and `flex-1` inside an
 * auto-height parent collapses to nothing.
 *
 * A dialog that wants a definite height in PIXELS passes `Dialog`'s `height`
 * instead, which arrives as a custom property read by a class rather than as an
 * inline `height`: Tailwind compiles its arbitrary values at build time, so an
 * `h-[${n}px]` assembled here would name a class that was never generated, and
 * an inline height would beat the full-bleed phone rule in index.css. The
 * max-height below still caps it.
 */
export const sizeClasses = (size: DialogSize, expanded: boolean, fill = false): string => {
  const width = expanded ? EXPANDED : WIDTH[size];
  if (fill) return `${width} ${expanded ? 'h-[94vh]' : 'h-[85vh]'}`;
  return `${width} ${expanded ? HEIGHT_EXPANDED : HEIGHT}`;
};

/**
 * Which stacking layer a dialog sits on. The app already used three z-indexes
 * by hand; naming them keeps a dialog that opens OVER another from having to
 * guess a number.
 *
 * `base` is an ordinary dialog. `over` is one a base dialog can open on top of
 * itself (a motor's spec sheet over the motor list). `top` is one that opens over
 * an `over` (the rename prompt, reached from inside the design library).
 *
 * The app-wide ConfirmDialog is not on this scale: it is its own component with
 * its own z-index, and it currently shares `top`'s value, so a confirmation
 * raised from a `top` dialog is ordered by DOM position rather than by layer.
 * Worth separating, but it means touching the confirm flow.
 */
export type DialogLayer = 'base' | 'over' | 'top';

export const layerClass: Record<DialogLayer, string> = {
  base: 'z-50',
  over: 'z-[60]',
  top: 'z-[70]',
};

/** Where the expanded-dialog preferences live. Namespaced like the rest. */
const KEY = 'astrarrocketjs:dialogExpanded';

/**
 * Whether the user has expanded this dialog before.
 *
 * Persisted per dialog id, because expanding is a preference rather than a
 * gesture: someone who wants the parts picker wide wants it wide every time,
 * and re-expanding it on every open would be the same annoyance as re-typing a
 * filter. Reads and writes are guarded: localStorage throws in a private window
 * with site data blocked, and a dialog must still open.
 */
export function readExpanded(id: string): boolean {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return false;
    const map: unknown = JSON.parse(raw);
    return !!map && typeof map === 'object' && (map as Record<string, unknown>)[id] === true;
  } catch {
    return false;
  }
}

export function writeExpanded(id: string, expanded: boolean): void {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    const map: Record<string, boolean> =
      parsed && typeof parsed === 'object' ? (parsed as Record<string, boolean>) : {};
    // Only the expanded ones are stored, so the key does not grow a `false` for
    // every dialog the user ever opened and collapsed again.
    if (expanded) map[id] = true;
    else delete map[id];
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    // A preference that cannot be saved is not a reason to refuse the resize.
  }
}
