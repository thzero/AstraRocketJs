// OpenRocket's built-in materials, ported verbatim from upstream
// core/.../database/Databases.java (name, density, group). The engine applies
// materials by DENSITY, so that is all the app needs to reproduce OpenRocket's
// mass/CG. Densities are SI: bulk kg/m^3, surface kg/m^2, line kg/m.
//
// Custom (user-defined) materials are NOT here — they live in localStorage and
// merge in at runtime (see services/materials.ts).

export type MaterialType = 'bulk' | 'surface' | 'line';

export interface Material {
  name: string;
  type: MaterialType;
  /** bulk: kg/m^3 · surface: kg/m^2 · line: kg/m */
  density: number;
  /** Upstream MaterialGroup, used to group the picker. */
  group: string;
  /** true for user-defined materials; absent/false for built-ins. */
  custom?: boolean;
}

export const BUILTIN_MATERIALS: Material[] = [
  // --- BULK (kg/m^3) ---
  { name: 'Acrylic', type: 'bulk', density: 1190, group: 'Plastics' },
  { name: 'Delrin', type: 'bulk', density: 1420, group: 'Plastics' },
  { name: 'Nylon', type: 'bulk', density: 1150, group: 'Fibers' },
  { name: 'Polycarbonate (Lexan)', type: 'bulk', density: 1200, group: 'Plastics' },
  { name: 'Polystyrene', type: 'bulk', density: 1050, group: 'Plastics' },
  { name: 'PVC', type: 'bulk', density: 1390, group: 'Plastics' },
  { name: 'PLA - 100% infill', type: 'bulk', density: 1250, group: 'Plastics' },
  { name: 'PETG - 100% infill', type: 'bulk', density: 1250, group: 'Plastics' },
  { name: 'ABS - 100% infill', type: 'bulk', density: 1050, group: 'Plastics' },
  { name: 'ASA - 100% infill', type: 'bulk', density: 1050, group: 'Plastics' },
  { name: 'Aluminum', type: 'bulk', density: 2700, group: 'Metals' },
  { name: 'Brass', type: 'bulk', density: 8600, group: 'Metals' },
  { name: 'Steel', type: 'bulk', density: 7850, group: 'Metals' },
  { name: 'Titanium', type: 'bulk', density: 4500, group: 'Metals' },
  { name: 'Balsa', type: 'bulk', density: 170, group: 'Woods' },
  { name: 'Basswood', type: 'bulk', density: 500, group: 'Woods' },
  { name: 'Birch', type: 'bulk', density: 670, group: 'Woods' },
  { name: 'Cork', type: 'bulk', density: 240, group: 'Woods' },
  { name: 'Maple', type: 'bulk', density: 755, group: 'Woods' },
  { name: 'Pine', type: 'bulk', density: 530, group: 'Woods' },
  { name: 'Plywood (birch)', type: 'bulk', density: 630, group: 'Woods' },
  { name: 'Spruce', type: 'bulk', density: 450, group: 'Woods' },
  { name: 'Carbon fiber', type: 'bulk', density: 1780, group: 'Composites' },
  { name: 'Fiberglass', type: 'bulk', density: 1850, group: 'Composites' },
  { name: 'Kraft phenolic', type: 'bulk', density: 950, group: 'Composites' },
  { name: 'Blue tube', type: 'bulk', density: 1300, group: 'Composites' },
  { name: 'Quantum tubing', type: 'bulk', density: 1050, group: 'Plastics' },
  { name: 'Cardboard', type: 'bulk', density: 680, group: 'Paper' },
  { name: 'Paper (office)', type: 'bulk', density: 820, group: 'Paper' },
  { name: 'Depron (XPS)', type: 'bulk', density: 40, group: 'Foams' },
  { name: 'Styrofoam (generic EPS)', type: 'bulk', density: 20, group: 'Foams' },
  { name: 'Styrofoam "Blue foam" (XPS)', type: 'bulk', density: 32, group: 'Foams' },

  // --- SURFACE (kg/m^2) ---
  { name: 'Ripstop nylon', type: 'surface', density: 0.067, group: 'Fabrics' },
  { name: 'Mylar', type: 'surface', density: 0.021, group: 'Plastics' },
  { name: 'Polyethylene (thin)', type: 'surface', density: 0.015, group: 'Plastics' },
  { name: 'Polyethylene (heavy)', type: 'surface', density: 0.040, group: 'Plastics' },
  { name: 'Silk', type: 'surface', density: 0.060, group: 'Fabrics' },
  { name: 'Paper (office)', type: 'surface', density: 0.080, group: 'Paper' },
  { name: 'Cellophane', type: 'surface', density: 0.018, group: 'Plastics' },
  { name: 'Crêpe paper', type: 'surface', density: 0.025, group: 'Paper' },

  // --- LINE (kg/m) ---
  { name: 'Thread (heavy-duty)', type: 'line', density: 0.0003, group: 'Other' },
  { name: 'Elastic cord (round 2 mm, 1/16 in)', type: 'line', density: 0.0018, group: 'Elastics' },
  { name: 'Elastic cord (flat 6 mm, 1/4 in)', type: 'line', density: 0.0043, group: 'Elastics' },
  { name: 'Elastic cord (flat 12 mm, 1/2 in)', type: 'line', density: 0.008, group: 'Elastics' },
  { name: 'Elastic cord (flat 19 mm, 3/4 in)', type: 'line', density: 0.0012, group: 'Elastics' },
  { name: 'Elastic cord (flat 25 mm, 1 in)', type: 'line', density: 0.0016, group: 'Elastics' },
  { name: 'Braided nylon (2 mm, 1/16 in)', type: 'line', density: 0.001, group: 'Nylons' },
  { name: 'Braided nylon (3 mm, 1/8 in)', type: 'line', density: 0.0035, group: 'Nylons' },
  { name: 'Tubular nylon (11 mm, 7/16 in)', type: 'line', density: 0.013, group: 'Nylons' },
  { name: 'Tubular nylon (14 mm, 9/16 in)', type: 'line', density: 0.016, group: 'Nylons' },
  { name: 'Tubular nylon (25 mm, 1 in)', type: 'line', density: 0.029, group: 'Nylons' },
  { name: 'Kevlar thread 138  (0.4 mm, 1/64 in)', type: 'line', density: 0.00014808, group: 'Kevlars' },
  { name: 'Kevlar thread 207  (0.5 mm, 1/64 in)', type: 'line', density: 0.00023622, group: 'Kevlars' },
  { name: 'Kevlar thread 346  (0.7 mm, 1/32 in)', type: 'line', density: 0.00047243, group: 'Kevlars' },
  { name: 'Kevlar thread 415  (0.8 mm, 1/32 in)', type: 'line', density: 0.00055117, group: 'Kevlars' },
  { name: 'Kevlar thread 800 (1.1 mm, 3/64 in)', type: 'line', density: 0.00099211, group: 'Kevlars' },
  { name: 'Kevlar 12-strand (3.2 mm, 1/8 in)', type: 'line', density: 0.00967306, group: 'Kevlars' },
  { name: 'Kevlar 12-strand (4.8 mm, 3/16 in)', type: 'line', density: 0.01785797, group: 'Kevlars' },
  { name: 'Kevlar 12-strand (6.4 mm, 1/4 in)', type: 'line', density: 0.02976328, group: 'Kevlars' },
  { name: 'Kevlar 12-strand (7.9 mm, 5/16 in)', type: 'line', density: 0.04464491, group: 'Kevlars' },
];
