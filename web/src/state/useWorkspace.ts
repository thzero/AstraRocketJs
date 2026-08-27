import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { buildRocketTree, specToTree, C6, type RocketSpec, type StaticInfo } from '../engine/api';
import type { MotorSpec, RocketTree, ComponentNode, ComponentType as PartType } from '../engine/openRocketEngine';
import { findMountId, findNode, updateNode, removeNode, addPart, moveNode, siblingIndex } from '../services/treeEdit';
import type { LaunchConditions } from '../services/orkTree';
import { downloadOrk } from '../services/saveOrk';
import type { OrkExportMotor } from '../services/orkFile';
import { loadOrk, type MountMotor } from '../services/loadOrk';
import { getWorkspaceStore } from '../services/workspaceStore';
import { newSimulation, simConditions, type Simulation } from '../services/simulations';
import { appName, defaultDesignName } from '../services/appInfo';
import { useViewState } from './useViewState';

// A clean, classic sport rocket (~55 cm, 26 mm airframe, swept 3-fin) — sleeker
// proportions than the old stubby default and comfortably stable on the C6.
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

/**
 * The whole application controller: the editable design tree, the named
 * simulations over it, the live engine rebuild (stability), view/selection UI
 * state, .ork import/export, and localStorage persistence. App.tsx just wires
 * the returned handles into the presentational panels.
 */
export function useWorkspace() {
  const { t, i18n } = useTranslation();
  // Keep the browser tab title in sync with the (translated) app name.
  useEffect(() => { document.title = appName(); }, [i18n.language]);

  // --- Design: the component tree is the single source of truth ---
  const [tree, setTree] = useState<RocketTree>(() => specToTree(DEFAULT_SPEC).tree);
  const [info, setInfo] = useState<StaticInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null); // two-way select: tree ↔ canvas
  // Motors for mounts OTHER than the primary one (multi-motor .ork imports).
  const [extraMotors, setExtraMotors] = useState<Record<string, MountMotor>>({});
  // Source metadata for an imported .ork (banner + round-trip export). null for the built-in design.
  const [loadedMeta, setLoadedMeta] = useState<{ name: string; notes: string[]; exportMotors: Record<string, OrkExportMotor> } | null>(null);
  const rocketRef = useRef<ReturnType<typeof buildRocketTree> | null>(null);
  const mountId = useMemo(() => findMountId(tree), [tree]);

  // --- Simulations: named flight setups (motor + launch + result) over the design ---
  const [sims, setSims] = useState<Simulation[]>(() => [newSimulation('Simulation 1', C6, DEFAULT_LAUNCH)]);
  const [activeId, setActiveId] = useState('');
  const [simBusy, setSimBusy] = useState(false);
  const active = sims.find((s) => s.id === activeId) ?? sims[0];
  const motor = active.motor;
  const launch = active.launch;
  const patchActive = (patch: Partial<Simulation>) => setSims((ss) => ss.map((s) => (s.id === active.id ? { ...s, ...patch } : s)));
  const setActiveMotor = (m: MotorSpec) => patchActive({ motor: m, result: null });
  const patchLaunch = (p: Partial<LaunchConditions>) => patchActive({ launch: { ...active.launch, ...p }, result: null });
  const addSim = () => { const s = newSimulation(t('sims.untitled', { n: sims.length + 1 }), active.motor, active.launch); setSims([...sims, s]); setActiveId(s.id); };
  const deleteSim = (id: string) => { const rest = sims.filter((s) => s.id !== id); if (rest.length) { setSims(rest); if (id === active.id) setActiveId(rest[0].id); } };
  const renameSim = (id: string, name: string) => setSims((ss) => ss.map((s) => (s.id === id ? { ...s, name } : s)));

  // --- View / navigation UI state (its own self-contained hook) ---
  const vs = useViewState();

  // --- Persistence: restore on load, autosave (debounced) after ---
  const hydrated = useRef(false);
  useEffect(() => {
    let live = true;
    getWorkspaceStore().load().then((w) => {
      if (live && w) {
        setTree(w.tree); setSims(w.sims); setActiveId(w.activeId);
        setExtraMotors(w.extraMotors); setLoadedMeta(w.loadedMeta);
      }
      hydrated.current = true;
    });
    return () => { live = false; };
  }, []);
  useEffect(() => {
    if (!hydrated.current) return;
    const id = setTimeout(() => {
      getWorkspaceStore().save({ version: 1, tree, sims, activeId: active.id, extraMotors, loadedMeta });
    }, 500);
    return () => clearTimeout(id);
  }, [tree, sims, activeId, extraMotors, loadedMeta]);

  // Rebuild + recompute static info whenever the design or motors change. The
  // primary mount takes the active sim's `motor`; other mounts take their imports.
  useEffect(() => {
    try {
      const r = buildRocketTree(tree, motor, mountId);
      for (const [id, m] of Object.entries(extraMotors)) {
        if (id === mountId || !findNode(tree, id)) continue; // gone or already the primary
        r.setMotorById(id, m.spec);
        if (m.ignitionEvent) r.setMotorIgnitionById(id, m.ignitionEvent, m.ignitionDelay ?? 0);
      }
      rocketRef.current = r;
      setInfo(r.staticInfo());
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setInfo(null);
    }
  }, [tree, motor, mountId, extraMotors]);

  // Editing the design invalidates every simulation's cached result.
  useEffect(() => {
    setSims((ss) => (ss.some((s) => s.result) ? ss.map((s) => ({ ...s, result: null })) : ss));
  }, [tree]);

  // --- Tree editing ---
  const selectedNode = useMemo(() => (selectedId ? findNode(tree, selectedId) : null), [tree, selectedId]);
  const sib = useMemo(() => (selectedId ? siblingIndex(tree, selectedId) : null), [tree, selectedId]);
  const patchSelected = (patch: Partial<ComponentNode>) => { if (selectedId) setTree((tr) => updateNode(tr, selectedId, patch)); };
  const removeSelected = () => { if (selectedId) { setTree((tr) => removeNode(tr, selectedId)); setSelectedId(null); } };
  const addPartToTree = (type: PartType) => { const { tree: next, id } = addPart(tree, type, selectedId); setTree(next); setSelectedId(id); };
  const moveSelected = (dir: -1 | 1) => { if (selectedId) setTree((tr) => moveNode(tr, selectedId, dir)); };
  const renameDesign = (name: string) => setTree((tr) => ({ ...tr, name }));

  // Motor dimensions for the 2D/3D views (primary mount + any extra mounts).
  const motorsForView = useMemo(() => {
    const m: Record<string, { length: number; diameter: number; label?: string }> = {};
    if (mountId) m[mountId] = { length: motor.length, diameter: motor.diameter, label: motor.designation };
    for (const [id, mm] of Object.entries(extraMotors)) m[id] = { length: mm.spec.length, diameter: mm.spec.diameter, label: mm.spec.designation };
    return m;
  }, [motor, mountId, extraMotors]);

  // --- File / workspace lifecycle ---
  const openOrkFile = async (file: File) => {
    try {
      const res = await loadOrk(await file.arrayBuffer());
      // Import into the editable model: the primary mount's motor drives the Motor
      // panel; the rest ride along in extraMotors. The rebuild effect recomputes stability.
      const primary = findMountId(res.tree);
      const extra = { ...res.motorSpecs };
      const primaryMotor = primary && extra[primary] ? extra[primary].spec : C6;
      if (primary && extra[primary]) delete extra[primary];
      const sim0 = newSimulation(res.name, primaryMotor, { ...DEFAULT_LAUNCH, ...res.launch });
      setTree(res.tree);
      setExtraMotors(extra);
      setLoadedMeta({ name: res.name, notes: res.notes, exportMotors: res.motors });
      setSims([sim0]);
      setActiveId(sim0.id);
      setSelectedId(null);
      setErr(null);
      vs.setTab('build');
    } catch (e) {
      setErr(`Could not open .ork: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  // Discard everything and start a fresh built-in design with one simulation.
  const resetWorkspace = () => {
    const s0 = newSimulation('Simulation 1', C6, DEFAULT_LAUNCH);
    setTree(specToTree(DEFAULT_SPEC).tree);
    setExtraMotors({});
    setLoadedMeta(null);
    setSims([s0]);
    setActiveId(s0.id);
    setSelectedId(null);
  };
  const newWorkspace = () => { if (window.confirm(t('file.newConfirm'))) resetWorkspace(); };

  const saveOrk = () => {
    try {
      // Export the current tree with all seated motors. Preserve imported fields
      // (manufacturer, ignition) via the source refs where present.
      const base = loadedMeta?.exportMotors ?? {};
      const motors: Record<string, OrkExportMotor> = {};
      if (mountId) motors[mountId] = { ...base[mountId], designation: motor.designation, diameter: motor.diameter, length: motor.length, delay: motor.ejectionDelay };
      for (const [id, m] of Object.entries(extraMotors)) {
        if (!findNode(tree, id)) continue;
        motors[id] = { ...base[id], designation: m.spec.designation, diameter: m.spec.diameter, length: m.spec.length, delay: m.spec.ejectionDelay, ignitionEvent: m.ignitionEvent, ignitionDelay: m.ignitionDelay };
      }
      downloadOrk({ name: loadedMeta?.name || tree.name || defaultDesignName(), tree, motors });
    } catch (e) {
      setErr(`Could not save .ork: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // --- Run the active simulation ---
  const runSim = () => {
    setSimBusy(true);
    const simId = active.id;
    // Yield so the spinner paints before the (synchronous) engine call.
    setTimeout(() => {
      try {
        const r = rocketRef.current;
        if (!r) return;
        const result = r.simulate(simConditions(launch));
        setSims((ss) => ss.map((s) => (s.id === simId ? { ...s, result } : s)));
        vs.setView('flight'); // show the fresh flight profile in the main window
        setErr(null);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setSimBusy(false);
      }
    }, 0);
  };

  return {
    err, setErr,
    // design
    tree, info, motorsForView, loadedMeta,
    selectedId, setSelectedId, selectedNode, sib,
    patchSelected, removeSelected, addPartToTree, moveSelected, renameDesign,
    // simulations
    sims, active, motor, launch, simBusy,
    setActiveId, addSim, deleteSim, renameSim, setActiveMotor, patchLaunch, runSim,
    // view / navigation (tab, view, twoD, roll, rollBy, resetKey, resetView, setters)
    ...vs,
    // file / workspace
    openOrkFile, saveOrk, newWorkspace, resetWorkspace,
  };
}
