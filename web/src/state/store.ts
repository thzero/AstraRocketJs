import { create } from 'zustand';
import i18n from '../i18n';
import { buildRocketTree, specToTree, C6, type RocketSpec, type StaticInfo } from '../engine/api';
import type { MotorSpec, RocketTree, ComponentNode, ComponentType as PartType } from '../engine/openRocketEngine';
import { findMountId, findNode, updateNode, removeNode, addPart, moveNode } from '../services/treeEdit';
import type { LaunchConditions } from '../services/orkTree';
import { downloadOrk } from '../services/saveOrk';
import type { OrkExportMotor } from '../services/orkFile';
import { loadOrk, type MountMotor } from '../services/loadOrk';
import { newSimulation, simConditions, type Simulation, type SimPrefs } from '../services/simulations';
import { simulateInWorker } from '../engine/simClient';
import { loadSettings } from '../services/settings';
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
  /** Set the motor for a non-primary mount (multi-mount rockets). */
  setExtraMotor: (mountId: string, m: MotorSpec) => void;
  patchLaunch: (p: Partial<LaunchConditions>) => void;
  addSim: () => void;
  duplicateSim: (id: string) => void;
  deleteSim: (id: string) => void;
  renameSim: (id: string, name: string) => void;
  runSim: (prefs: SimPrefs) => Promise<void>;

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

/** A motor is usable only if it carries a full thrust curve (time/thrust/mass samples). */
const hasThrustCurve = (m: MotorSpec | undefined | null): boolean =>
  !!(m && m.times?.length && m.thrusts?.length && m.masses?.length);

/**
 * Repair a persisted workspace so a stale/partial blob can't blank the app.
 * Two corruptions have been seen in the wild, both from a save that raced an
 * async operation: a sim's `launch` missing fields (blank Launch panel), and a
 * motor persisted before its thrust-curve fetch resolved (empty curve → the
 * engine rebuild throws "Too short thrust-curve" → no CG/CP/stats). We merge
 * each launch over the current defaults and swap any curve-less motor for C6 so
 * the design always renders; the user can re-pick the intended motor.
 */
function sanitizeSims(sims: Simulation[]): Simulation[] {
  const launchDefaults = loadSettings().launchDefaults;
  const safe = (Array.isArray(sims) ? sims : []).filter((s) => s && typeof s.id === 'string');
  if (!safe.length) return [newSimulation('Simulation 1', C6, launchDefaults)];
  return safe.map((s) => ({
    ...s,
    launch: { ...launchDefaults, ...(s.launch ?? {}) },
    motor: hasThrustCurve(s.motor) ? s.motor : C6,
    result: null,
  }));
}

/** Motor case dimensions for the 2D/3D views (primary mount + any extra mounts). */
export function selectMotorDims(tree: RocketTree, motor: MotorSpec, extraMotors: Record<string, MountMotor>): MotorDims {
  const m: MotorDims = {};
  const mountId = findMountId(tree);
  if (mountId) m[mountId] = { length: motor.length, diameter: motor.diameter, label: motor.designation };
  for (const [id, mm] of Object.entries(extraMotors)) m[id] = { length: mm.spec.length, diameter: mm.spec.diameter, label: mm.spec.designation };
  return m;
}

/** First `label(n)` (n = start, start+1, …) not already used by a sim — so New
 *  and Duplicate never reuse a name, even after deletions. */
function uniqueSimName(sims: Simulation[], label: (n: number) => string, start: number): string {
  const taken = new Set(sims.map((x) => x.name));
  let n = start;
  while (taken.has(label(n))) n++;
  return label(n);
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
    sims: [newSimulation('Simulation 1', C6, loadSettings().launchDefaults)],
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
    hydrate: (w) => {
      const sims = sanitizeSims(w.sims);
      const activeId = sims.some((s) => s.id === w.activeId) ? w.activeId : sims[0].id;
      set({ tree: w.tree, sims, activeId, extraMotors: w.extraMotors ?? {}, loadedMeta: w.loadedMeta ?? null });
    },

    setTree: (tree) => set({ tree }),
    setSelectedId: (selectedId) => set({ selectedId }),
    patchSelected: (patch) => { const { selectedId, tree } = get(); if (selectedId) set({ tree: updateNode(tree, selectedId, patch) }); },
    removeSelected: () => { const { selectedId, tree } = get(); if (selectedId) set({ tree: removeNode(tree, selectedId), selectedId: null }); },
    addPartToTree: (type) => { const { tree, selectedId } = get(); const { tree: next, id } = addPart(tree, type, selectedId); set({ tree: next, selectedId: id }); },
    moveSelected: (dir) => { const { selectedId, tree } = get(); if (selectedId) set({ tree: moveNode(tree, selectedId, dir) }); },
    renameDesign: (name) => set((s) => ({ tree: { ...s.tree, name } })),

    setActiveId: (activeId) => set({ activeId }),
    setActiveMotor: (m) => patchActive({ motor: m, result: null }),
    setExtraMotor: (mountId, m) => set((s) => ({
      extraMotors: { ...s.extraMotors, [mountId]: { ...s.extraMotors[mountId], spec: m } },
      // Extra motors are workspace-level, so every sim's cached result is now stale.
      sims: s.sims.some((x) => x.result) ? s.sims.map((x) => ({ ...x, result: null })) : s.sims,
    })),
    patchLaunch: (p) => patchActive({ launch: { ...selectActive(get()).launch, ...p }, result: null }),
    addSim: () => {
      // A fresh simulation starts from the app default motor + the user's global
      // launch defaults (duplicateSim carries an existing setup forward instead).
      const s = get();
      const name = uniqueSimName(s.sims, (n) => i18n.t('sims.untitled', { n }), s.sims.length + 1);
      const s0 = newSimulation(name, C6, loadSettings().launchDefaults);
      set({ sims: [...s.sims, s0], activeId: s0.id });
    },
    duplicateSim: (id) => {
      const s = get();
      const src = s.sims.find((x) => x.id === id);
      if (!src) return;
      const copy = i18n.t('sims.copyName', { name: src.name });
      const name = uniqueSimName(s.sims, (n) => (n === 1 ? copy : `${copy} ${n}`), 1);
      const s0 = newSimulation(name, src.motor, src.launch);
      const next = [...s.sims];
      next.splice(s.sims.findIndex((x) => x.id === id) + 1, 0, s0);
      set({ sims: next, activeId: s0.id });
    },
    deleteSim: (id) => {
      const s = get();
      const rest = s.sims.filter((x) => x.id !== id);
      if (!rest.length) return;
      set({ sims: rest, activeId: id === selectActive(s).id ? rest[0].id : s.activeId });
    },
    renameSim: (id, name) => set((s) => ({ sims: s.sims.map((x) => (x.id === id ? { ...x, name } : x)) })),
    runSim: async (prefs) => {
      set({ simBusy: true });
      const s = get();
      const active = selectActive(s);
      const simId = active.id;
      // The sim runs in a Web Worker (its own engine instance), off the main
      // thread, so a ~500 ms flight never freezes the UI. The worker rebuilds
      // the rocket from the current tree/motors — identical to the main-thread
      // build (buildConfiguredRocket) — so the result matches what's on screen.
      try {
        const result = await simulateInWorker({
          tree: s.tree,
          motor: active.motor,
          extraMotors: s.extraMotors,
          options: simConditions(active.launch, prefs),
        });
        set((st) => ({ sims: st.sims.map((x) => (x.id === simId ? { ...x, result } : x)), view: 'flight', err: null }));
      } catch (e) {
        set({ err: e instanceof Error ? e.message : String(e) });
      } finally {
        set({ simBusy: false });
      }
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
        const sim0 = newSimulation(res.name, primaryMotor, { ...loadSettings().launchDefaults, ...res.launch });
        set({
          tree: res.tree, extraMotors: extra,
          loadedMeta: { name: res.name, notes: res.notes, exportMotors: res.motors },
          sims: [sim0], activeId: sim0.id, selectedId: null, err: null, tab: 'build', view: '2d',
        });
      } catch (e) {
        set({ err: `Could not open .ork: ${e instanceof Error ? e.message : String(e)}` });
      }
    },
    resetWorkspace: () => {
      const s0 = newSimulation('Simulation 1', C6, loadSettings().launchDefaults);
      set({ tree: specToTree(DEFAULT_SPEC).tree, extraMotors: {}, loadedMeta: null, sims: [s0], activeId: s0.id, selectedId: null, view: '2d' });
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
        downloadOrk({ name: loadedMeta?.name || tree.name || defaultDesignName(), tree, motors, launch: selectActive(get()).launch });
      } catch (e) {
        set({ err: `Could not save .ork: ${e instanceof Error ? e.message : String(e)}` });
      }
    },
  };
});
