/**
 * The warning palette and row shell, shared by everything in the results column
 * that has to say "look at this".
 *
 * It lived inside FlightWarnings while that was the only reader. The safety
 * card's "not modeled" row is the second, and a copied class string is a
 * palette that drifts: retune the amber in one place and the other row quietly
 * keeps the old one.
 *
 * HIGH reads as a problem, the rest as a note. Never color alone: every row
 * that wears these also carries the ⚠ glyph and says in words what it is about.
 */
export const WARNING_TONE: Record<string, string> = {
  HIGH: 'bg-red-500/10 text-red-300 ring-red-400/30',
  NORMAL: 'bg-amber-500/10 text-amber-200 ring-amber-400/30',
  LOW: 'bg-slate-800 text-slate-300 ring-white/10',
};

/** The shell every warning row shares: glyph column, padding, ring, text size. */
export const WARNING_ROW = 'flex gap-2 rounded-lg px-2.5 py-1.5 text-xs ring-1';
