// Minimal stub. The schematic's IMAGE-EXPORT path uses fmtSi/UnitSelection, but
// AstraRocketJs never passes exportData, so this is compile-only, never run.
export type UnitSelection = any;
export const fmtSi = (...args: unknown[]): string => String(args[0] ?? '');
