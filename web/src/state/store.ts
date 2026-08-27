import { create } from 'zustand';
import i18n from '../i18n';
import { buildRocketTree, specToTree, C6, type RocketSpec, type StaticInfo } from '../engine/api';
import type { MotorSpec, RocketTree, ComponentNode, ComponentType as PartType } from '../engine/openRocketEngine';
import { findMountId, findNode, updateNode, removeNode, addPart, moveNode } from '../services/treeEdit';
import type { LaunchConditions } from '../services/orkTree';
import { downloadOrk } from '../services/saveOrk';
import type { OrkExportMotor } from '../services/orkFile';
import { loadOrk, type MountMotor } from '../services/loadOrk';
import { newSimulation, simConditions, type Simulation } from '../services/simulations';
import { defaultDesignName } from '../services/appInfo';
import type { MotorDims } from '../components/canvas/Rocket3D';
import type { ViewMode } from '../components/canvas/ViewToggle';
import type { Tab } from '../components/layout/TabBar';

// A clean, classic sport rocket (~55 cm, 26 mm airframe, swept 3-fin).
const DEFAULT_SPEC: RocketSpec = {
  noseCone: { length: 0.13, aftRadius: 0.013, thickness: 0.0008, shape: 'ogive' },
  bodyTube: { length: 0.42, outerRadius: 0.013, thickness: 0.0005 },
  fins: { count: 3, rootChord: 0.08, tipChord: 0.038, sweep: 0.055, height: 0.058, thickness: 0.0028 },
  motorMount: { length: 0.07, outerRadius: 0.0092, thickness: 0.0004 },
  parachute: { diameter: 0.4, dragCoefficient: 0.8 },
};

// Sea-level, calm, standard-atmosphere defaults (Cape Canaveral latitude).
const DEFAULT_LAUNCH: LaunchConditions = {
  launchRodLengthM: 1, launchRodAngleDeg: 0,
  windAverage: 0, windStdDev: 0, windDirectionDeg: 90,
  launchAltitudeM: 0, latitudeDeg: 28.61,
  temperatureC: null, pressureHPa: null,
  geodetic: 'spherical',
};

type Rocket = ReturnType<typeof buildRocketTree>;
type LoadedMeta = { name: string; notes: string[]; exportMotors: Record<string, OrkExportMotor> } | null;

export interface WorkspaceState {
  // --- design ---
  tree: RocketTree;
  info: StaticInfo | null;
  err: string | null;
  selectedId: string | null;
  extraMotors: Record<string, MountMotor>;
  loadedMeta: LoadedMeta;
  rocket: Rocket | null; // live engine handle (set by the rebuild effect; used by runSim)
  // --- simulations ---
  sims: Simulation[];
  activeId: string;
  simBusy: boolean;
  // --- view / navigation ---
  tab: Tab;
  view: ViewMode;
  twoD: 'side' | 'aft';
  roll: number;     // 2D fin-spin, radians, kept in [0, 2π)
  resetKey: number; // bump to remount the 2D schematic

  // --- actions ---
  setErr: (err: string | null) => void;
  applyBuild: (info: StaticInfo | null, rocket: Rocket | null) => void; // from the rebuild effect
  invalidateResults: () => void;                                        // from the tree-change effect
  hydrate: (w: { tree: RocketTree; sims: Simulation[]; activeId: string; extraMotors: Record<string, MountMotor>; loadedMeta: LoadedMeta }) => void;

  setTree: (tree: RocketTree) => void;
  setSelectedId: (id: string | null) => void;
  patchSelected: (patch: Partial<ComponentNode>) => void;
  removeSelected: () => void;
  addPartToTree: (type: PartType) => void;
  moveSelected: (dir: -1 | 1) => void;
  renameDesign: (name: string) => void;

  setActiveId: (id: string) => void;
  setActiveMotor: (m: MotorSpec) => void;
  patchLaunch: (p: Partial<LaunchConditions>) => void;
  addSim: () => void;
  deleteSim: (id: string) => void;
  renameSim: (id: string, name: string) => void;
  runSim: () => void;

  setTab: (tab: Tab) => void;
  setView: (view: ViewMode) => void;
  setTwoD: (v: 'side' | 'aft') => void;
  setRoll: (roll: number) => void;
  rollBy: (d: number) => void;
  resetView: () => void;

  openOrkFile: (file: File) => Promise<void>;
  resetWorkspace: () => void;
  newWorkspace: () => void;
  saveOrk: () => void;
}

/** The active simulation (falls back to the first if the id no longer exists). */
export const selectActive = (s: WorkspaceState): Simulation => s.sims.find((x) => x.id === s.activeId) ?? s.sims[0];

/** Motor case dimensions for the 2D/3D views (primary mount + any extra mounts). */
export function selectMotorDims(tree: RocketTree, motor: MotorSpec, extraMotors: Record<string, MountMotor>): MotorDims {
  const m: MotorDims = {};
  const mountId = findMountId(tree);
  if (mountId) m[mountId] = { length: motor.length, diameter: motor.diameter, label: motor.designation };
  for (const [id, mm] of Object.entries(extraMotors)) m[id] = { length: mm.spec.length, diameter: mm.spec.diameter, label: mm.spec.designation };
  return m;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => {
  // Patch the active simulation (invalidating its cached result).
  const patchActive = (patch: Partial<Simulation>) => {
    const id = selectActive(get()).id;
    set((s) => ({ sims: s.sims.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
  };

  return {
    tree: specToTree(DEFAULT_SPEC).tree,
    info: null,
    err: null,
    selectedId: null,
    extraMotors: {},
    loadedMeta: null,
    rocket: null,
    sims: [newSimulation('Simulation 1', C6, DEFAULT_LAUNCH)],
    activeId: '',
    simBusy: false,
    tab: 'build',
    view: '2d',
    twoD: 'side',
    roll: 0,
    resetKey: 0,

    setErr: (err) => set({ err }),
    applyBuild: (info, rocket) => set({ info, rocket }),
    invalidateResults: () => set((s) => (s.sims.some((x) => x.result) ? { sims: s.sims.map((x) => ({ ...x, result: null })) } : {})),
    hydrate: (w) => set({ tree: w.tree, sims: w.sims, activeId: w.activeId, extraMotors: w.extraMotors, loadedMeta: w.loadedMeta }),

    setTree: (tree) => set({ tree }),
    setSelectedId: (selectedId) => set({ selectedId }),
    patchSelected: (patch) => { const { selectedId, tree } = get(); if (selectedId) set({ tree: updateNode(tree, selectedId, patch) }); },
    removeSelected: () => { const { selectedId, tree } = get(); if (selectedId) set({ tree: removeNode(tree, selectedId), selectedId: null }); },
    addPartToTree: (type) => { const { tree, selectedId } = get(); const { tree: next, id } = addPart(tree, type, selectedId); set({ tree: next, selectedId: id }); },
    moveSelected: (dir) => { const { selectedId, tree } = get(); if (selectedId) set({ tree: moveNode(tree, selectedId, dir) }); },
    renameDesign: (name) => set((s) => ({ tree: { ...s.tree, name } })),

    setActiveId: (activeId) => set({ activeId }),
    setActiveMotor: (m) => patchActive({ motor: m, result: null }),
    patchLaunch: (p) => patchActive({ launch: { ...selectActive(get()).launch, ...p }, result: null }),
    addSim: () => {
      const s = get();
      const a = selectActive(s);
      const s0 = newSimulation(i18n.t('sims.untitled', { n: s.sims.length + 1 }), a.motor, a.launch);
      set({ sims: [...s.sims, s0], activeId: s0.id });
    },
    deleteSim: (id) => {
      const s = get();
      const rest = s.sims.filter((x) => x.id !== id);
      if (!rest.length) return;
      set({ sims: rest, activeId: id === selectActive(s).id ? rest[0].id : s.activeId });
    },
    renameSim: (id, name) => set((s) => ({ sims: s.sims.map((x) => (x.id === id ? { ...x, name } : x)) })),
    runSim: () => {
      set({ simBusy: true });
      const simId = selectActive(get()).id;
      const launch = selectActive(get()).launch;
      // Yield so the spinner paints before the (synchronous) engine call.
      setTimeout(() => {
        try {
          const r = get().rocket;
          if (!r) return;
          const result = r.simulate(simConditions(launch));
          set((s) => ({ sims: s.sims.map((x) => (x.id === simId ? { ...x, result } : x)), view: 'flight', err: null }));
        } catch (e) {
          set({ err: e instanceof Error ? e.message : String(e) });
        } finally {
          set({ simBusy: false });
        }
      }, 0);
    },

    setTab: (tab) => set({ tab }),
    setView: (view) => set({ view }),
    setTwoD: (twoD) => set({ twoD }),
    setRoll: (roll) => set({ roll }),
    rollBy: (d) => set((s) => { const x = (s.roll + d) % (2 * Math.PI); return { roll: x < 0 ? x + 2 * Math.PI : x }; }),
    resetView: () => set((s) => ({ roll: 0, resetKey: s.resetKey + 1 })),

    openOrkFile: async (file) => {
      try {
        const res = await loadOrk(await file.arrayBuffer());
        // The primary mount's motor drives the Motor panel; the rest ride along in extraMotors.
        const primary = findMountId(res.tree);
        const extra = { ...res.motorSpecs };
        const primaryMotor = primary && extra[primary] ? extra[primary].spec : C6;
        if (primary && extra[primary]) delete extra[primary];
        const sim0 = newSimulation(res.name, primaryMotor, { ...DEFAULT_LAUNCH, ...res.launch });
        set({
          tree: res.tree, extraMotors: extra,
          loadedMeta: { name: res.name, notes: res.notes, exportMotors: res.motors },
          sims: [sim0], activeId: sim0.id, selectedId: null, err: null, tab: 'build',
        });
      } catch (e) {
        set({ err: `Could not open .ork: ${e instanceof Error ? e.message : String(e)}` });
      }
    },
    resetWorkspace: () => {
      const s0 = newSimulation('Simulation 1', C6, DEFAULT_LAUNCH);
      set({ tree: specToTree(DEFAULT_SPEC).tree, extraMotors: {}, loadedMeta: null, sims: [s0], activeId: s0.id, selectedId: null });
    },
    newWorkspace: () => { if (window.confirm(i18n.t('file.newConfirm'))) get().resetWorkspace(); },
    saveOrk: () => {
      try {
        const { tree, extraMotors, loadedMeta } = get();
        const motor = selectActive(get()).motor;
        const mountId = findMountId(tree);
        const base = loadedMeta?.exportMotors ?? {};
        const motors: Record<string, OrkExportMotor> = {};
        if (mountId) motors[mountId] = { ...base[mountId], designation: motor.designation, diameter: motor.diameter, length: motor.length, delay: motor.ejectionDelay };
        for (const [id, m] of Object.entries(extraMotors)) {
          if (!findNode(tree, id)) continue;
          motors[id] = { ...base[id], designation: m.spec.designation, diameter: m.spec.diameter, length: m.spec.length, delay: m.spec.ejectionDelay, ignitionEvent: m.ignitionEvent, ignitionDelay: m.ignitionDelay };
        }
        downloadOrk({ name: loadedMeta?.name || tree.name || defaultDesignName(), tree, motors });
      } catch (e) {
        set({ err: `Could not save .ork: ${e instanceof Error ? e.message : String(e)}` });
      }
    },
  };
});
