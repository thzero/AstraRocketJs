/** `x` rounded to `places` decimal places, as a number. */
export const roundTo = (x: number, places: number): number => Math.round(x * 10 ** places) / 10 ** places;

/** A real number: of type number, and neither NaN nor infinite. */
export const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
