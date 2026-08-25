import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { buildRocket, specToTree, C6, type RocketSpec, type StaticInfo, type FlightResult } from './engine/api';
import type { MotorSpec, RocketTree } from './engine/openRocketEngine';
import { downloadOrk } from './services/saveOrk';
import type { OrkExportMotor } from './services/orkFile';
import { TreeSchematic } from './components/TreeSchematic';
import { AftView } from './components/AftView';

// three.js is heavy, so the 3D view is code-split — its chunk loads only when
// the user actually switches to 3D, keeping the default (2D) path light.
const Rocket3D = lazy(() => import('./components/Rocket3D').then((m) => ({ default: m.Rocket3D })));
import { loadCatalog, filterMotors, allClasses, importCustomMotorFromEng, deleteCustomMotor, type CatalogMotor } from './services/motorDb';
import { fetchMotorSpec } from './services/thrustcurve';
import { builtinsForType, materialsForType, addCustom, removeCustom } from './services/materials';
import type { Material } from './data/materials';
import { componentsForType, filterComponents, type ComponentType, type Component } from './services/componentDb';
import { loadOrk } from './services/loadOrk';

const DEFAULT_SPEC: RocketSpec = {
  noseCone: { length: 0.07, aftRadius: 0.012, thickness: 0.001, shape: 'ogive' },
  bodyTube: { length: 0.2, outerRadius: 0.012, thickness: 0.0003 },
  fins: { count: 3, rootChord: 0.05, tipChord: 0.03, sweep: 0.02, height: 0.05, thickness: 0.0032 },
  motorMount: { length: 0.07, outerRadius: 0.009, thickness: 0.0003 },
  parachute: { diameter: 0.3, dragCoefficient: 0.8 },
};

type Tab = 'build' | 'motor' | 'sim';

export default function App() {
  const [spec, setSpec] = useState<RocketSpec>(DEFAULT_SPEC);
  const [tab, setTab] = useState<Tab>('build');
  const [motor, setMotor] = useState<MotorSpec>(C6);
  const [info, setInfo] = useState<StaticInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sim, setSim] = useState<FlightResult | null>(null);
  const [simBusy, setSimBusy] = useState(false);
  const [loaded, setLoaded] = useState<{ name: string; notes: string[]; tree: RocketTree; motors: Record<string, OrkExportMotor> } | null>(null);
  const [view, setView] = useState<'2d' | '3d'>('2d');
  const [twoD, setTwoD] = useState<'side' | 'aft'>('side');
  const [roll, setRoll] = useState(0); // 2D fin-spin, radians
  const [resetKey, setResetKey] = useState(0); // bump to remount 2D schematic (resets its zoom/pan)
  const resetView = () => { setRoll(0); setResetKey((k) => k + 1); };
  const rocketRef = useRef<ReturnType<typeof buildRocket> | null>(null);
  const orkRef = useRef<HTMLInputElement>(null);

  // Rebuild + recompute static info whenever the design or motor changes.
  useEffect(() => {
    if (loaded) return; // a .ork design is loaded — don't rebuild from the editor spec
    try {
      const r = buildRocket(spec, motor);
      rocketRef.current = r;
      setInfo(r.staticInfo());
      setErr(null);
      setSim(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setInfo(null);
    }
  }, [spec, motor, loaded]);

  const openOrk = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-opening the same file
    if (!file) return;
    try {
      const res = await loadOrk(await file.arrayBuffer());
      rocketRef.current = res.design;
      setInfo(res.info);
      setLoaded({ name: res.name, notes: res.notes, tree: res.tree, motors: res.motors });
      setSim(null);
      setErr(null);
      setTab('build');
    } catch (err) {
      setErr(`Could not open .ork: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  const closeLoaded = () => { setLoaded(null); setSim(null); };

  const saveOrk = () => {
    try {
      if (loaded) {
        downloadOrk({ name: loaded.name, tree: loaded.tree, motors: loaded.motors });
      } else {
        const { tree, mountId } = specToTree(spec);
        downloadOrk({
          name: 'FakeRocket design',
          tree,
          motors: { [mountId]: { designation: motor.designation, diameter: motor.diameter, length: motor.length, delay: motor.ejectionDelay } },
        });
      }
    } catch (e) {
      setErr(`Could not save .ork: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // The design as a component tree, for the 2D/3D views: the loaded .ork tree,
  // or the editor spec lowered to a tree.
  const designTree = useMemo(() => (loaded ? loaded.tree : specToTree(spec).tree), [loaded, spec]);
  const motorsForView = useMemo(() => {
    if (loaded) {
      const m: Record<string, { length: number; diameter: number; label?: string }> = {};
      for (const [id, mo] of Object.entries(loaded.motors)) m[id] = { length: mo.length, diameter: mo.diameter, label: mo.designation };
      return m;
    }
    return { mount: { length: motor.length, diameter: motor.diameter, label: motor.designation } };
  }, [loaded, motor]);

  const runSim = () => {
    setSimBusy(true);
    // Yield so the spinner paints before the (synchronous) engine call.
    setTimeout(() => {
      try {
        const r = rocketRef.current;
        if (!r) return;
        setSim(r.simulate({ launchRodLength: 1.0, series: 'summary' }));
        setErr(null);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setSimBusy(false);
      }
    }, 0);
  };

  return (
    <div className="flex h-screen flex-col bg-slate-950 text-slate-100">
      <header className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
        <span className="text-xl">🚀</span>
        <h1 className="text-base font-semibold tracking-tight">FakeRocket</h1>
        <div className="ml-auto flex gap-2">
          <button
            onClick={() => orkRef.current?.click()}
            className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200"
          >
            Open .ork
          </button>
          <button
            onClick={saveOrk}
            disabled={!info}
            className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 disabled:opacity-40"
          >
            Save .ork
          </button>
        </div>
        <input ref={orkRef} type="file" accept=".ork" className="hidden" onChange={openOrk} />
      </header>

      {err && (
        <p className="border-b border-red-500/30 bg-red-950/60 px-4 py-2 text-sm text-red-300">{err}</p>
      )}

      {/* Mobile: one section at a time via the bottom tabs. lg+: a 3-pane
          workbench (editor · canvas · motor+sim), each pane scrolling on its own. */}
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-24 lg:grid lg:grid-cols-[340px_minmax(0,1fr)_380px] lg:overflow-hidden lg:pb-0">
        {/* CENTER — canvas / loaded design + stability (first on mobile) */}
        <section className={`${tab === 'build' ? '' : 'hidden'} order-1 lg:order-none lg:col-start-2 lg:row-start-1 lg:block lg:h-full lg:overflow-y-auto`}>
          {loaded && <LoadedBanner loaded={loaded} onClose={closeLoaded} />}
          <div className="flex justify-end px-3 pt-3">
            <ViewToggle view={view} onChange={setView} />
          </div>
          {/* Both views share one sized box so toggling 2D↔3D doesn't resize. */}
          <div className="relative h-[70vh] min-h-[420px] w-full px-3 pt-2 lg:h-[calc(100vh_-_14rem)]">
            {view === '2d' && (
              <>
                <div className="absolute inset-y-2 left-1 z-10 flex w-6 items-stretch">
                  <input
                    type="range" min={0} max={360} step={5}
                    value={Math.round((roll * 180) / Math.PI)}
                    onChange={(e) => setRoll((parseFloat(e.target.value) * Math.PI) / 180)}
                    title="Roll — spin the fins about the axis (or drag the drawing)"
                    aria-label="Roll angle"
                    className="accent-sky-500"
                    style={{ writingMode: 'vertical-lr', width: '100%', height: '100%' }}
                  />
                </div>
                {/* View presets, upper-left (mirrors the 3D view's buttons). */}
                <div className="absolute left-9 top-3 z-10 flex gap-1">
                  <ViewBtn onClick={resetView}>⟲ Reset</ViewBtn>
                  <ViewBtn active={twoD === 'side'} onClick={() => setTwoD('side')}>Side</ViewBtn>
                  <ViewBtn active={twoD === 'aft'} onClick={() => setTwoD('aft')}>Aft</ViewBtn>
                </div>
              </>
            )}
            {view === '2d'
              ? (twoD === 'side'
                  ? <TreeSchematic key={`side-${resetKey}`} tree={designTree} info={info} motors={motorsForView} fillHeight roll={roll} onRoll={(d) => setRoll((r) => r + d)} />
                  : <AftView key={`aft-${resetKey}`} tree={designTree} roll={roll} motors={motorsForView} onRoll={(d) => setRoll((r) => r + d)} />)
              : <Suspense fallback={<div className="grid h-full place-items-center text-sm text-slate-500">Loading 3D…</div>}>
                  <Rocket3D tree={designTree} info={info} motors={motorsForView} />
                </Suspense>}
          </div>
          <StabilityBadge info={info} />
        </section>

        {/* LEFT — design editor */}
        <section className={`${tab === 'build' ? '' : 'hidden'} order-2 lg:order-none lg:col-start-1 lg:row-start-1 lg:block lg:h-full lg:overflow-y-auto lg:border-r lg:border-white/10`}>
          {loaded
            ? <p className="m-3 rounded-lg bg-slate-900 p-3 text-xs text-slate-500 ring-1 ring-white/10">A .ork design is loaded (view + simulate). Close it in the center panel to edit your own design.</p>
            : <Editor spec={spec} onChange={setSpec} />}
        </section>

        {/* RIGHT — motor + simulate (stacked) */}
        <div className={`${tab === 'motor' || tab === 'sim' ? '' : 'hidden'} order-3 lg:order-none lg:col-start-3 lg:row-start-1 lg:block lg:h-full lg:overflow-y-auto lg:border-l lg:border-white/10`}>
          <section className={`${tab === 'motor' ? '' : 'hidden'} lg:block`}>
            <MotorPanel selected={motor} onSelect={setMotor} onError={setErr} />
          </section>
          <section className={`${tab === 'sim' ? '' : 'hidden'} lg:block lg:border-t lg:border-white/10`}>
            <SimPanel info={info} runLabel={loaded ? loaded.name : motor.designation} sim={sim} busy={simBusy} onRun={runSim} />
          </section>
        </div>
      </main>

      <nav className="flex border-t border-white/10 bg-slate-900/95 backdrop-blur lg:hidden">
        <TabButton active={tab === 'build'} onClick={() => setTab('build')} label="Build" icon="🛠️" />
        <TabButton active={tab === 'motor'} onClick={() => setTab('motor')} label="Motor" icon="🔥" />
        <TabButton active={tab === 'sim'} onClick={() => setTab('sim')} label="Simulate" icon="📈" />
      </nav>
    </div>
  );
}

function TabButton({ active, onClick, label, icon }: { active: boolean; onClick: () => void; label: string; icon: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-1 flex-col items-center gap-0.5 py-3 text-xs ${active ? 'text-sky-400' : 'text-slate-400'}`}
    >
      <span className="text-lg">{icon}</span>
      {label}
    </button>
  );
}

// ---------- Stability ----------

function StabilityBadge({ info }: { info: StaticInfo | null }) {
  if (!info) return null;
  const cal = info.stabilityCalibers;
  const tone = cal >= 1 ? 'text-emerald-400' : cal >= 0 ? 'text-amber-400' : 'text-red-400';
  const verdict = cal >= 1 ? 'Stable' : cal >= 0 ? 'Marginal' : 'Unstable';
  return (
    <div className="mx-3 mt-3 grid grid-cols-4 gap-2 rounded-xl bg-slate-900 p-3 ring-1 ring-white/10">
      <Stat label="Stability" value={`${cal.toFixed(2)}`} sub={`cal · ${verdict}`} tone={tone} />
      <Stat label="Mass" value={`${(info.mass * 1000).toFixed(0)}`} sub="g" />
      <Stat label="CG" value={`${(info.cg * 100).toFixed(1)}`} sub="cm" />
      <Stat label="CP" value={`${(info.cp * 100).toFixed(1)}`} sub="cm" />
    </div>
  );
}

function Stat({ label, value, sub, tone = 'text-slate-100' }: { label: string; value: string; sub: string; tone?: string }) {
  return (
    <div className="text-center">
      <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${tone}`}>{value}</div>
      <div className="text-[10px] text-slate-500">{sub}</div>
    </div>
  );
}

// ---------- 2D / 3D view toggle ----------

const VIEWS: readonly [('2d' | '3d'), string][] = [['2d', '2D'], ['3d', '3D']];

function ViewToggle({ view, onChange }: { view: '2d' | '3d'; onChange: (v: '2d' | '3d') => void }) {
  return (
    <div className="inline-flex overflow-hidden rounded-lg ring-1 ring-white/10">
      {VIEWS.map(([v, label]) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={`px-3 py-1 text-xs font-semibold ${view === v ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-300'}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** Small overlay button for the 2D view presets (Side / Aft / Reset). */
function ViewBtn({ active, onClick, children }: { active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-2 py-1 text-xs font-medium ring-1 ring-white/10 ${active ? 'bg-sky-600 text-white' : 'bg-slate-800/90 text-slate-200'}`}
    >
      {children}
    </button>
  );
}

// ---------- Loaded .ork banner ----------

function LoadedBanner({ loaded, onClose }: { loaded: { name: string; notes: string[] }; onClose: () => void }) {
  return (
    <div className="m-3 rounded-xl bg-slate-900 p-3 ring-1 ring-white/10">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wide text-slate-400">Loaded design (.ork)</div>
          <div className="truncate text-lg font-semibold text-sky-400">{loaded.name}</div>
        </div>
        <button onClick={onClose} className="shrink-0 rounded-lg bg-slate-800 px-3 py-1.5 text-xs text-slate-300">Close</button>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Full-fidelity import — stability and Simulate work on the real component tree. Editing the
        loaded tree isn't supported yet.
      </p>
      {loaded.notes.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs text-amber-400/90">
          {loaded.notes.map((n, i) => <li key={i}>• {n}</li>)}
        </ul>
      )}
    </div>
  );
}

// ---------- Editor ----------

function Editor({ spec, onChange }: { spec: RocketSpec; onChange: (s: RocketSpec) => void }) {
  const set = (mut: (s: RocketSpec) => void) => {
    const next = structuredClone(spec);
    mut(next);
    onChange(next);
  };

  const applyNose = (p: Component) => {
    if (p.type !== 'nosecone') return;
    set((s) => {
      s.noseCone.shape = p.shape;
      s.noseCone.length = p.length;
      s.noseCone.aftRadius = p.outerDiameter / 2;
      s.bodyTube.outerRadius = p.outerDiameter / 2; // keep the tube matched to the nose base
      if (p.filled) s.noseCone.thickness = p.outerDiameter / 2;
      if (p.materialDensity) { s.noseCone.material = p.material; s.noseCone.materialDensity = p.materialDensity; }
    });
  };
  const applyBody = (p: Component) => {
    if (p.type !== 'bodytube') return;
    set((s) => {
      s.bodyTube.outerRadius = p.outerDiameter / 2;
      s.noseCone.aftRadius = p.outerDiameter / 2;
      s.bodyTube.length = p.length;
      if (p.innerDiameter) s.bodyTube.thickness = Math.max(0.0001, (p.outerDiameter - p.innerDiameter) / 2);
      if (p.materialDensity) { s.bodyTube.material = p.material; s.bodyTube.materialDensity = p.materialDensity; }
    });
  };
  const applyChute = (p: Component) => {
    if (p.type !== 'parachute') return;
    set((s) => { s.parachute = { diameter: p.diameter, dragCoefficient: p.cd ?? 0.8 }; });
  };

  return (
    <div className="space-y-4 p-3">
      <Group title="Nose cone">
        <ComponentPicker type="nosecone" onApply={applyNose} />
        <Slider label="Length" unit="mm" value={spec.noseCone.length} min={0.02} max={0.3} step={0.005} onChange={(v) => set((s) => { s.noseCone.length = v; })} />
        <Slider label="Radius" unit="mm" value={spec.noseCone.aftRadius} min={0.005} max={0.05} step={0.001} onChange={(v) => set((s) => { s.noseCone.aftRadius = v; s.bodyTube.outerRadius = v; })} />
        <MaterialPicker value={spec.noseCone.material} onChange={(name, d) => set((s) => { s.noseCone.material = name; s.noseCone.materialDensity = d; })} />
      </Group>
      <Group title="Body tube">
        <ComponentPicker type="bodytube" onApply={applyBody} />
        <Slider label="Length" unit="mm" value={spec.bodyTube.length} min={0.05} max={1.0} step={0.01} onChange={(v) => set((s) => { s.bodyTube.length = v; })} />
        <Slider label="Radius" unit="mm" value={spec.bodyTube.outerRadius} min={0.005} max={0.05} step={0.001} onChange={(v) => set((s) => { s.bodyTube.outerRadius = v; s.noseCone.aftRadius = v; })} />
        <MaterialPicker value={spec.bodyTube.material} onChange={(name, d) => set((s) => { s.bodyTube.material = name; s.bodyTube.materialDensity = d; })} />
      </Group>
      <Group title="Recovery">
        <ComponentPicker type="parachute" onApply={applyChute} />
        <Slider label="Chute diameter" unit="mm" value={spec.parachute?.diameter ?? 0.3} min={0.1} max={1.5} step={0.01} onChange={(v) => set((s) => { s.parachute = { diameter: v, dragCoefficient: s.parachute?.dragCoefficient ?? 0.8 }; })} />
        <Slider label="Drag coeff" unit="" value={spec.parachute?.dragCoefficient ?? 0.8} min={0.5} max={2.2} step={0.05} display={(v) => v.toFixed(2)} scale={1} onChange={(v) => set((s) => { s.parachute = { diameter: s.parachute?.diameter ?? 0.3, dragCoefficient: v }; })} />
      </Group>
      <Group title={`Fins (${spec.fins.count})`}>
        <Slider label="Count" unit="" value={spec.fins.count} min={2} max={6} step={1} display={(v) => String(v)} scale={1} onChange={(v) => set((s) => { s.fins.count = Math.round(v); })} />
        <Slider label="Root chord" unit="mm" value={spec.fins.rootChord} min={0.01} max={0.15} step={0.005} onChange={(v) => set((s) => { s.fins.rootChord = v; })} />
        <Slider label="Tip chord" unit="mm" value={spec.fins.tipChord} min={0} max={0.12} step={0.005} onChange={(v) => set((s) => { s.fins.tipChord = v; })} />
        <Slider label="Sweep" unit="mm" value={spec.fins.sweep} min={0} max={0.1} step={0.005} onChange={(v) => set((s) => { s.fins.sweep = v; })} />
        <Slider label="Height" unit="mm" value={spec.fins.height} min={0.01} max={0.12} step={0.005} onChange={(v) => set((s) => { s.fins.height = v; })} />
        <MaterialPicker value={spec.fins.material} onChange={(name, d) => set((s) => { s.fins.material = name; s.fins.materialDensity = d; })} />
      </Group>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl bg-slate-900 p-3 ring-1 ring-white/10">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Slider({
  label, unit, value, min, max, step, onChange,
  scale = 1000, display,
}: {
  label: string; unit: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; scale?: number; display?: (v: number) => string;
}) {
  const shown = display ? display(value) : (value * scale).toFixed(scale === 1000 ? 0 : 1);
  return (
    <label className="block">
      <div className="mb-1 flex justify-between text-sm">
        <span className="text-slate-300">{label}</span>
        <span className="tabular-nums text-slate-400">{shown}{unit && ` ${unit}`}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-sky-500"
      />
    </label>
  );
}

// ---------- Component picker (real manufacturer parts) ----------

function ComponentPicker({ type, onApply }: { type: ComponentType; onApply: (p: Component) => void }) {
  const all = useMemo(() => componentsForType(type), [type]);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const matches = useMemo(() => filterComponents(all, q).slice(0, 60), [all, q]);

  const label = (p: Component): string => {
    if (p.type === 'parachute') return `${(p.diameter * 1000).toFixed(0)} mm · Cd ${(p.cd ?? 0.8).toFixed(2)}`;
    if (p.type === 'nosecone') return `${p.shape} · ${(p.outerDiameter * 1000).toFixed(1)} mm · ${(p.length * 1000).toFixed(0)} mm`;
    // bodytube / tubecoupler / centeringring / bulkhead — all OD × length
    return `${(p.outerDiameter * 1000).toFixed(1)} mm · ${(p.length * 1000).toFixed(0)} mm`;
  };

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full rounded-lg bg-slate-800 px-2 py-1.5 text-xs font-medium text-slate-200"
      >
        {open ? 'Close parts' : `Pick a real part… (${all.length})`}
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <input
            value={q} onChange={(e) => setQ(e.target.value)} autoFocus
            placeholder="Search parts (mfr, part #, description)…"
            className="w-full rounded bg-slate-950 px-2 py-1.5 text-sm ring-1 ring-white/10 placeholder:text-slate-500"
          />
          <ul className="max-h-60 divide-y divide-white/5 overflow-y-auto rounded-lg ring-1 ring-white/10">
            {matches.map((p, i) => (
              <li key={`${p.mfr}:${p.partNo}:${i}`}>
                <button
                  onClick={() => { onApply(p); setOpen(false); }}
                  className="flex w-full items-center justify-between gap-2 bg-slate-950 px-2 py-1.5 text-left text-xs hover:bg-slate-800"
                >
                  <span className="min-w-0 truncate"><span className="text-slate-500">{p.mfr}</span> {p.partNo}</span>
                  <span className="shrink-0 tabular-nums text-slate-400">{label(p)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---------- Material picker (built-in + custom) ----------

function MaterialPicker({ value, onChange }: { value?: string; onChange: (name: string | undefined, density: number) => void }) {
  // Seed with built-ins for the first paint; the store (async, swappable) then
  // merges in the user's custom materials.
  const [mats, setMats] = useState<Material[]>(() => builtinsForType('bulk'));
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [dens, setDens] = useState('');
  const [addErr, setAddErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    materialsForType('bulk').then((m) => { if (live) setMats(m); });
    return () => { live = false; };
  }, []);

  const groups = useMemo(() => {
    const g = new Map<string, Material[]>();
    for (const m of mats) {
      if (!g.has(m.group)) g.set(m.group, []);
      g.get(m.group)!.push(m);
    }
    return [...g.entries()];
  }, [mats]);

  const current = mats.find((m) => m.name === value);

  const handleSelect = (v: string) => {
    if (v === '__default__') return onChange(undefined, 0);
    if (v === '__add__') return setAdding(true);
    const m = mats.find((x) => x.name === v);
    if (m) onChange(m.name, m.density);
  };

  const submitCustom = async () => {
    try {
      const next = await addCustom(name, 'bulk', parseFloat(dens));
      setMats(await materialsForType('bulk'));
      onChange(next[0].name, next[0].density);
      setAdding(false); setName(''); setDens(''); setAddErr(null);
    } catch (e) {
      setAddErr(e instanceof Error ? e.message : String(e));
    }
  };

  const deleteCurrentCustom = async () => {
    if (!current?.custom) return;
    await removeCustom(current.name, 'bulk');
    setMats(await materialsForType('bulk'));
    onChange(undefined, 0);
  };

  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="text-slate-300">Material</span>
        <span className="tabular-nums text-xs text-slate-400">
          {current ? `${current.density} kg/m³` : 'default'}
          {current?.custom && (
            <button onClick={deleteCurrentCustom} className="ml-2 text-red-400" aria-label="Delete custom material">✕</button>
          )}
        </span>
      </div>
      <select
        value={current ? current.name : '__default__'}
        onChange={(e) => handleSelect(e.target.value)}
        className="w-full rounded-lg bg-slate-950 px-2 py-2 text-sm text-slate-100 ring-1 ring-white/10"
      >
        <option value="__default__">Default (OpenRocket)</option>
        {groups.map(([g, list]) => (
          <optgroup key={g} label={g}>
            {list.map((m) => (
              <option key={`${g}:${m.name}`} value={m.name}>
                {m.custom ? '★ ' : ''}{m.name} · {m.density} kg/m³
              </option>
            ))}
          </optgroup>
        ))}
        <option value="__add__">＋ Add custom…</option>
      </select>

      {adding && (
        <div className="mt-2 space-y-2 rounded-lg bg-slate-950 p-2 ring-1 ring-white/10">
          <input
            value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (e.g. G10 fiberglass)"
            className="w-full rounded bg-slate-900 px-2 py-1.5 text-sm ring-1 ring-white/10 placeholder:text-slate-500"
          />
          <input
            value={dens} onChange={(e) => setDens(e.target.value)} type="number" min={0} step="any"
            placeholder="Bulk density (kg/m³)"
            className="w-full rounded bg-slate-900 px-2 py-1.5 text-sm tabular-nums ring-1 ring-white/10 placeholder:text-slate-500"
          />
          {addErr && <p className="text-xs text-red-400">{addErr}</p>}
          <div className="flex gap-2">
            <button onClick={submitCustom} className="flex-1 rounded bg-sky-600 py-1.5 text-sm font-medium text-white">Save</button>
            <button onClick={() => { setAdding(false); setAddErr(null); }} className="flex-1 rounded bg-slate-800 py-1.5 text-sm text-slate-300">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Motor picker ----------

function MotorPanel({
  selected, onSelect, onError,
}: {
  selected: MotorSpec;
  onSelect: (m: MotorSpec) => void;
  onError: (msg: string | null) => void;
}) {
  const [catalog, setCatalog] = useState<CatalogMotor[]>([]);
  useEffect(() => {
    let live = true;
    loadCatalog().then((c) => { if (live) setCatalog(c); });
    return () => { live = false; };
  }, []);
  const classes = useMemo(() => allClasses(catalog), [catalog]);
  const [text, setText] = useState('');
  const [cls, setCls] = useState<string | null>(null);
  const [delay, setDelay] = useState(3);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(
    () => filterMotors(catalog, {
      text,
      classes: cls ? new Set([cls]) : new Set(),
      manufacturers: new Set(),
    }),
    [catalog, text, cls],
  );
  const shown = matches.slice(0, 150);

  const pick = async (m: CatalogMotor, rowId: string) => {
    setLoadingId(rowId);
    onError(null);
    try {
      const spec = await fetchMotorSpec(m, delay);
      onSelect(spec);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingId(null);
    }
  };

  const onImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-importing the same file
    if (!file) return;
    onError(null);
    try {
      setCatalog(await importCustomMotorFromEng(await file.text()));
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  };

  const onDelete = async (m: CatalogMotor) => {
    if (!m.id) return;
    onError(null);
    try {
      setCatalog(await deleteCustomMotor(m.id));
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="space-y-3 p-3">
      <div className="rounded-xl bg-slate-900 p-3 ring-1 ring-white/10">
        <div className="text-[10px] uppercase tracking-wide text-slate-400">Selected motor</div>
        <div className="text-lg font-semibold text-sky-400">{selected.designation}</div>
        <div className="text-xs text-slate-500">
          {(selected.diameter * 1000).toFixed(0)} mm · {(selected.length * 1000).toFixed(0)} mm ·
          {' '}{(selected.masses[0] * 1000).toFixed(1)} g · {selected.times.length} pts
        </div>
      </div>

      <div className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Search motors (e.g. C6, Estes)…"
          className="min-w-0 flex-1 rounded-lg bg-slate-900 px-3 py-2 text-sm text-slate-100 ring-1 ring-white/10 placeholder:text-slate-500"
        />
        <button
          onClick={() => fileRef.current?.click()}
          className="shrink-0 rounded-lg bg-slate-800 px-3 py-2 text-xs font-medium text-slate-200"
        >
          Import .eng
        </button>
        <input ref={fileRef} type="file" accept=".eng,.ENG" className="hidden" onChange={onImport} />
      </div>

      <div className="flex flex-wrap gap-1">
        <Chip label="All" active={cls === null} onClick={() => setCls(null)} />
        {classes.map((c) => (
          <Chip key={c} label={c} active={cls === c} onClick={() => setCls(cls === c ? null : c)} />
        ))}
      </div>

      <label className="flex items-center justify-between text-sm text-slate-300">
        <span>Ejection delay</span>
        <span className="flex items-center gap-2">
          <input
            type="number" min={0} max={20} step={0.5} value={delay}
            onChange={(e) => setDelay(Math.max(0, parseFloat(e.target.value) || 0))}
            className="w-16 rounded bg-slate-900 px-2 py-1 text-right tabular-nums ring-1 ring-white/10"
          />
          <span className="text-slate-500">s</span>
        </span>
      </label>

      <div className="text-[10px] uppercase tracking-wide text-slate-500">
        {matches.length} motors{matches.length > shown.length ? ` (showing ${shown.length})` : ''}
      </div>

      <ul className="divide-y divide-white/5 overflow-hidden rounded-xl ring-1 ring-white/10">
        {shown.map((m, i) => {
          const rowId = `${m.manufacturer}:${m.designation}:${i}`;
          const loading = loadingId === rowId;
          return (
            <li key={rowId} className="flex items-stretch bg-slate-900">
              <button
                onClick={() => pick(m, rowId)}
                disabled={loadingId !== null}
                className="flex min-w-0 flex-1 items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-800 disabled:opacity-50"
              >
                <span className="min-w-0">
                  {m.custom && <span className="mr-1 text-amber-400" title="Imported motor">★</span>}
                  <span className="font-medium text-slate-100">{m.designation}</span>
                  <span className="ml-2 text-xs text-slate-500">{m.manufacturer}</span>
                </span>
                <span className="shrink-0 text-xs tabular-nums text-slate-400">
                  {loading ? 'loading…' : `${m.impulse < 10 ? m.impulse.toFixed(1) : m.impulse.toFixed(0)} Ns · ${m.diameter} mm`}
                </span>
              </button>
              {m.custom && (
                <button
                  onClick={() => onDelete(m)}
                  aria-label={`Delete imported motor ${m.designation}`}
                  className="shrink-0 px-3 text-red-400 hover:bg-slate-800"
                >
                  ✕
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-2.5 py-1 text-xs font-medium ${active ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-300'}`}
    >
      {label}
    </button>
  );
}

// ---------- Simulation ----------

function SimPanel({ info, runLabel, sim, busy, onRun }: { info: StaticInfo | null; runLabel: string; sim: FlightResult | null; busy: boolean; onRun: () => void }) {
  const s = sim?.summary;
  return (
    <div className="space-y-4 p-3">
      <button
        onClick={onRun}
        disabled={busy || !info}
        className="w-full rounded-xl bg-sky-600 py-3 font-semibold text-white disabled:opacity-50"
      >
        {busy ? 'Simulating…' : `Run flight simulation (${runLabel})`}
      </button>

      {s && (
        <>
          <div className="grid grid-cols-3 gap-2 rounded-xl bg-slate-900 p-3 ring-1 ring-white/10">
            <Stat label="Apogee" value={s.maxAltitude.toFixed(0)} sub="m" tone="text-sky-400" />
            <Stat label="Max speed" value={s.maxVelocity.toFixed(0)} sub="m/s" />
            <Stat label="Max accel" value={s.maxAcceleration.toFixed(0)} sub="m/s²" />
            <Stat label="To apogee" value={s.timeToApogee.toFixed(1)} sub="s" />
            <Stat label="Flight time" value={s.flightTime.toFixed(1)} sub="s" />
            <Stat label="Rod exit" value={s.launchRodVelocity.toFixed(1)} sub="m/s" />
          </div>
          <AltitudeChart sim={sim!} />
        </>
      )}
      {!s && !busy && <p className="text-center text-sm text-slate-500">Run a simulation to see the flight profile.</p>}
    </div>
  );
}

function AltitudeChart({ sim }: { sim: FlightResult }) {
  const t = (sim.series.time ?? []) as number[];
  const alt = (sim.series.altitude ?? []) as number[];
  const pts = useMemo(() => t.map((ti, i) => [ti, alt[i] ?? 0] as const).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b)), [t, alt]);
  if (pts.length < 2) return null;

  const W = 360, H = 180, pad = 28;
  const maxT = Math.max(...pts.map((p) => p[0]));
  const maxA = Math.max(...pts.map((p) => p[1]));
  const x = (v: number) => pad + (v / maxT) * (W - pad - 8);
  const y = (v: number) => H - pad - (v / maxA) * (H - pad - 8);
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(' ');

  return (
    <div className="rounded-xl bg-slate-900 p-3 ring-1 ring-white/10">
      <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Altitude vs time</h2>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        <line x1={pad} y1={H - pad} x2={W - 8} y2={H - pad} className="stroke-white/20" />
        <line x1={pad} y1={8} x2={pad} y2={H - pad} className="stroke-white/20" />
        <path d={path} className="fill-none stroke-sky-400" strokeWidth={2} />
        <text x={pad} y={H - 8} className="fill-slate-500 text-[9px]">0</text>
        <text x={W - 24} y={H - 8} className="fill-slate-500 text-[9px]">{maxT.toFixed(0)}s</text>
        <text x={4} y={14} className="fill-slate-500 text-[9px]">{maxA.toFixed(0)}m</text>
      </svg>
    </div>
  );
}
