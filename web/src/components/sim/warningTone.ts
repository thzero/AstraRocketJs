/**
 * The warning palette and row shell, shared by everything in the results column
 * that has to say "look at this".
 *
 * Shared rather than copied into each reader (FlightWarnings, the safety card's
 * "not modeled" row): a copied class string is a palette that drifts, so retuning
 * the amber in one place leaves the other row on the previous value.
 *
 * HIGH reads as a problem, the rest as a note. Never color alone: every row
 * that wears these also carries the ⚠ glyph and says in words what it is about.
 */
export const WARNING_TONE: Record<string, string> = {
  HIGH: 'bg-danger-500/10 text-danger-300 ring-danger-400/30',
  NORMAL: 'bg-warn-500/10 text-warn-200 ring-warn-400/30',
  LOW: 'bg-raised text-ink-soft ring-line/10',
};

/** The shell every warning row shares: glyph column, padding, ring, text size. */
export const WARNING_ROW = 'flex gap-2 rounded-lg px-2.5 py-1.5 text-xs ring-1';
