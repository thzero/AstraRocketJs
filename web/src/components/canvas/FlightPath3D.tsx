import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Line, Html } from '@react-three/drei';
import type { ComponentNode, FlightResult, RocketTree } from '../../engine/openRocketEngine';
import { buildPieces, type MotorDims } from './Rocket3D';
import { colorForType, mergePalette, type PartPalette } from '../../services/partColors';
import { useSettings } from '../../state/SettingsProvider';
import { fmtNum } from '../../i18n/format';

/**
 * 3D flight path (adapted from Vector Celeste's Flight3D, one better). Draws the
 * REAL trajectory (Px/Py drift × altitude) as a phase-coloured arc over a ground
 * plane, with the actual design model flying along it (buildPieces) — sitting on
 * the pad at launch, nose-along-velocity during boost/coast (with a layered motor
 * flame), then hanging under its actual recovery device (parachute sized to its
 * real diameter, or a streamer, or nothing) on descent. Event callouts, a live
 * HUD, and play · scrub · speed transport.
 */
const MODEL_LEN = 1.6; // scene units the rocket model is scaled to — kept small vs the ~24u arc; the follow-cam makes it readable
const PLAY_SECONDS = 8; // wall-clock length of a full 1× playback (time-based, so boost isn't slow)
const UP = new THREE.Vector3(0, 1, 0);
const num = (n: ComponentNode, k: string, d = 0): number => (typeof n[k] === 'number' ? (n[k] as number) : d);

type Recovery =
  | { kind: 'parachute'; diameter: number; color: string }
  | { kind: 'streamer'; length: number; width: number; color: string }
  | null;
const recColor = (n: ComponentNode, palette: PartPalette): string => (typeof n.color === 'string' ? n.color : colorForType(n.type, palette));
function findRecovery(tree: RocketTree, palette: PartPalette): Recovery {
  let found: Recovery = null;
  const walk = (nodes: ComponentNode[]) => {
    for (const n of nodes) {
      if (!found && n.type === 'parachute') found = { kind: 'parachute', diameter: num(n, 'diameter', 0.3), color: recColor(n, palette) };
      else if (!found && n.type === 'streamer') found = { kind: 'streamer', length: num(n, 'length', 0.4), width: num(n, 'width', 0.05), color: recColor(n, palette) };
      if (n.children) walk(n.children);
    }
  };
  walk(tree.components);
  return found;
}

const EVENT_LABEL: Record<string, string> = {
  BURNOUT: 'flight.burnout', APOGEE: 'flight.apogee',
  RECOVERY_DEVICE_DEPLOYMENT: 'flight.deploy', EJECTION_CHARGE: 'flight.ejection', GROUND_HIT: 'flight.landing',
};

export function FlightPath3D({ result, tree, motors }: { result: FlightResult; tree: RocketTree; motors?: MotorDims }) {
  const { t } = useTranslation();
  const { settings, update } = useSettings();
  const palette = useMemo(() => mergePalette(settings.partColors), [settings.partColors]);
  const phase = settings.phaseColors; // boost/coast/descent colors, from Settings
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(false); // start on the pad; play → countdown → launch
  const [speed, setSpeed] = useState(settings.playbackSpeed); // seeded from the Settings default
  const [follow, setFollow] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [loop, setLoop] = useState(false);
  const progressRef = useRef(0);

  const { pieces, totalLen, maxR } = useMemo(() => buildPieces(tree, motors, palette), [tree, motors, palette]);
  useEffect(() => () => { for (const p of pieces) p.geometry.dispose(); }, [pieces]);
  const modelScale = MODEL_LEN / Math.max(totalLen, 0.05);
  const recovery = useMemo(() => findRecovery(tree, palette), [tree, palette]);

  const { colors, scenePts, apogeeIdx, deployT, burnoutT, times, alts, vels, callouts } = useMemo(() => {
    const time = (result.series.time ?? []) as number[];
    const alt = (result.series.altitude ?? []) as number[];
    const vel = (result.series.velocity ?? []) as number[];
    const px = (result.series.Px ?? []) as (number | null)[];
    const py = (result.series.Py ?? []) as (number | null)[];
    const rows: { t: number; a: number; v: number; x: number; z: number }[] = [];
    for (let i = 0; i < time.length; i++) {
      if (!Number.isFinite(time[i]) || !Number.isFinite(alt[i])) continue;
      rows.push({ t: time[i], a: alt[i], v: Number.isFinite(vel[i]) ? vel[i] : 0, x: Number(px[i]) || 0, z: Number(py[i]) || 0 });
    }
    const maxA = Math.max(1, ...rows.map((r) => r.a));
    const s = 24 / maxA;
    const evT = (type: string) => result.events.find((e) => e.type === type)?.time;
    const bt = evT('BURNOUT') ?? 0;
    const apT = evT('APOGEE') ?? result.summary.timeToApogee ?? maxA;
    const dpT = evT('RECOVERY_DEVICE_DEPLOYMENT') ?? evT('EJECTION_CHARGE') ?? apT;
    const sp = rows.map((r) => new THREE.Vector3(r.x * s, r.a * s, r.z * s));
    const cols = rows.map((r): [number, number, number] => {
      const c = new THREE.Color(r.t < bt ? phase.boost : r.t <= apT ? phase.coast : phase.descent);
      return [c.r, c.g, c.b];
    });
    let ai = 0; rows.forEach((r, i) => { if (r.a > rows[ai].a) ai = i; });
    const idxAt = (tt: number) => { let bi = 0, bd = Infinity; rows.forEach((r, i) => { const d = Math.abs(r.t - tt); if (d < bd) { bd = d; bi = i; } }); return bi; };
    // Dedup callouts by proximity in time; keep the most significant.
    const wanted: [string, number | undefined][] = [['BURNOUT', evT('BURNOUT')], ['APOGEE', apT], ['RECOVERY_DEVICE_DEPLOYMENT', evT('RECOVERY_DEVICE_DEPLOYMENT') ?? evT('EJECTION_CHARGE')], ['GROUND_HIT', evT('GROUND_HIT') ?? rows[rows.length - 1]?.t]];
    const cos: { type: string; pos: THREE.Vector3; time: number }[] = [];
    for (const [type, tt] of wanted) {
      if (tt == null) continue;
      const pos = sp[idxAt(tt)];
      if (cos.some((c) => c.pos.distanceTo(pos) < 1.5)) continue; // skip coincident label
      cos.push({ type, pos, time: tt });
    }
    return {
      colors: cols, scenePts: sp, apogeeIdx: ai, deployT: dpT, burnoutT: bt,
      flightTime: result.summary.flightTime || rows[rows.length - 1]?.t || 1,
      times: rows.map((r) => r.t), alts: rows.map((r) => r.a), vels: rows.map((r) => r.v), callouts: cos,
    };
  }, [result, phase]);

  useEffect(() => {
    if (!playing || scenePts.length < 2) return;
    let raf = 0, last = performance.now();
    const frame = (now: number) => {
      const dt = (now - last) / 1000; last = now;
      let np = progressRef.current + (dt * speed) / PLAY_SECONDS;
      if (np >= 1) {
        if (loop) np -= 1;                                    // wrap → keep flying
        else { progressRef.current = 1; setProgress(1); setPlaying(false); return; } // stop at landing
      }
      progressRef.current = np;
      setProgress(np);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, loop, scenePts.length]);

  // T-minus countdown before the initial launch: 5→4→3→2→1, then play from t=0.
  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) { setCountdown(null); progressRef.current = 0; setProgress(0); setPlaying(true); return; }
    const id = setTimeout(() => setCountdown((c) => (c === null ? null : c - 1)), 900);
    return () => clearTimeout(id);
  }, [countdown]);

  const handlePlay = () => {
    if (countdown !== null) { setCountdown(null); return; } // cancel a running countdown
    if (playing) { setPlaying(false); return; }
    if (progress <= 0.001 || progress >= 0.999) setCountdown(5); // fresh launch (from pad or after landing)
    else setPlaying(true);                                       // resume from a paused mid-flight
  };
  const handleReset = () => { setPlaying(false); setCountdown(null); progressRef.current = 0; setProgress(0); };

  if (scenePts.length < 2) {
    return <div className="grid h-full place-items-center text-sm text-slate-500">{t('sim.prompt')}</div>;
  }

  const n = scenePts.length;
  // progress is a fraction of *time* (not sample index): the sim packs most of its
  // samples into the fast boost/coast, so index-based playback crawls. Map by time.
  const totalT = times[n - 1] || 1;
  let idx = 0;
  while (idx < n - 1 && times[idx + 1] <= progress * totalT) idx++;
  const markerPos = scenePts[idx];
  const nowT = times[idx] ?? 0;
  const descending = nowT >= deployT;
  const boosting = nowT < burnoutT;
  const maxY = Math.max(...scenePts.map((p) => p.y));
  const midY = maxY / 2;
  const home = useMemo(() => new THREE.Vector3(maxY * 1.15, maxY * 0.62, maxY * 1.4), [maxY]);
  const followDist = MODEL_LEN * 3.4;

  // Orient nose (local -X) along velocity, or hang nose-up once the chute is out.
  const tangent = new THREE.Vector3().subVectors(scenePts[Math.min(n - 1, idx + 1)], scenePts[Math.max(0, idx - 1)]);
  if (tangent.lengthSq() < 1e-8) tangent.set(0, 1, 0); else tangent.normalize();
  const dir = descending ? UP : tangent;
  const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(-1, 0, 0), dir);
  // Centre the model on the trajectory point so it straddles the path (its nose no
  // longer shoots past the apogee marker), but lift it near the ground so it sits on
  // the pad at launch instead of sinking half-under it.
  const groupPos = markerPos.clone();
  groupPos.y += Math.max(0, (MODEL_LEN / 2) * Math.abs(dir.y) - markerPos.y);
  const noseWorld = groupPos.clone().addScaledVector(dir, MODEL_LEN / 2);
  const chuteR = recovery?.kind === 'parachute' ? Math.max(0.5, (recovery.diameter / 2) * modelScale) : 0;

  return (
    <div className="relative h-full overflow-hidden rounded-xl bg-slate-950 ring-1 ring-white/10">
      <Canvas camera={{ position: [34, 22, 34], fov: 42 }} gl={{ preserveDrawingBuffer: true }}>
        <hemisphereLight args={['#cfe8ff', '#0b1220', 1.5]} />
        <directionalLight position={[14, 26, 16]} intensity={1.7} />
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[60, 72]} />
          <meshStandardMaterial color="#0b1724" roughness={1} metalness={0.05} />
        </mesh>
        <gridHelper args={[120, 60, '#33506a', '#18293a']} position={[0, 0.02, 0]} />
        {/* Reveal the path only where the rocket has already flown; the rest stays hidden. */}
        {idx >= 1 && <Line points={scenePts.slice(0, idx + 1)} vertexColors={colors.slice(0, idx + 1)} lineWidth={3} />}
        <Marker pos={scenePts[0]} color="#e2e8f0" />
        {idx >= apogeeIdx && <Marker pos={scenePts[apogeeIdx]} color={phase.coast} />}
        {idx >= n - 1 && <Marker pos={scenePts[n - 1]} color={phase.descent} />}

        {callouts.filter((c) => nowT >= c.time).map((c, i) => (
          <Html key={i} position={[c.pos.x, c.pos.y, c.pos.z]} center style={{ pointerEvents: 'none' }}>
            <div className="whitespace-nowrap rounded bg-slate-900/85 px-1.5 py-0.5 text-[10px] font-medium text-amber-300 ring-1 ring-white/10">
              {t(EVENT_LABEL[c.type])}
            </div>
          </Html>
        ))}

        {/* The actual design model, flying along the path */}
        <group position={groupPos} quaternion={quat} scale={modelScale}>
          <group position={[-totalLen / 2, 0, 0]}>
            {pieces.map((p) => (
              <mesh key={p.key} geometry={p.geometry} position={p.position ?? [0, 0, 0]} rotation={p.rotation ?? [0, 0, 0]}>
                <meshStandardMaterial color={p.color} roughness={0.55} metalness={0.1} />
              </mesh>
            ))}
            {boosting && <Flame len={totalLen} r={maxR} />}
          </group>
        </group>

        {descending && recovery?.kind === 'parachute' && <Parachute attach={noseWorld} radius={chuteR} color={recovery.color} />}
        {descending && recovery?.kind === 'streamer' && <Streamer attach={noseWorld} length={recovery.length * modelScale} width={recovery.width * modelScale} color={recovery.color} />}

        <OrbitControls makeDefault enableDamping={!follow} maxPolarAngle={Math.PI * 0.495} minDistance={3} maxDistance={160} />
        <CamRig follow={follow} point={markerPos} dist={followDist} midY={midY} home={home} />
      </Canvas>

      <div className="pointer-events-none absolute left-3 top-3 flex gap-3 rounded-lg bg-slate-900/80 px-3 py-2 text-xs ring-1 ring-white/10">
        <Hud label={t('flight.altitude')} value={`${fmtNum(alts[idx] ?? 0, 0)} m`} />
        <Hud label={t('flight.velocity')} value={`${fmtNum(vels[idx] ?? 0, 0)} m/s`} />
        <Hud label={t('flight.time')} value={`${fmtNum(nowT, 1)} s`} />
      </div>
      <div className="pointer-events-none absolute right-3 top-3 flex flex-col gap-1 rounded-lg bg-slate-900/80 px-2 py-1.5 text-[10px] ring-1 ring-white/10">
        <Legend color={phase.boost} label={t('flight.boost')} onChange={(c) => update({ phaseColors: { ...phase, boost: c } })} />
        <Legend color={phase.coast} label={t('flight.coast')} onChange={(c) => update({ phaseColors: { ...phase, coast: c } })} />
        <Legend color={phase.descent} label={t('flight.descent')} onChange={(c) => update({ phaseColors: { ...phase, descent: c } })} />
      </div>
      <div className="absolute inset-x-3 bottom-3 flex items-center gap-2 rounded-lg bg-slate-900/85 px-3 py-2 ring-1 ring-white/10">
        <button onClick={handlePlay} className="shrink-0 rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-200 ring-1 ring-white/10 hover:bg-slate-700">
          {countdown !== null ? '✕' : playing ? '⏸' : '▶'}
        </button>
        <button onClick={handleReset} title={t('flight.reset')} className="shrink-0 rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-200 ring-1 ring-white/10 hover:bg-slate-700">
          ⟲
        </button>
        <button onClick={() => setLoop((l) => !l)} title={t('flight.loop')}
          className={`shrink-0 rounded-md px-2 py-1 text-xs ring-1 ring-white/10 ${loop ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'}`}>
          ⟳
        </button>
        <button onClick={() => setFollow((f) => !f)} title={t('flight.follow')}
          className={`shrink-0 rounded-md px-2 py-1 text-xs ring-1 ring-white/10 ${follow ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'}`}>
          ⊙ {t('flight.follow')}
        </button>
        <input type="range" min={0} max={1} step={0.001} value={progress}
          onChange={(e) => { setPlaying(false); const v = parseFloat(e.target.value); progressRef.current = v; setProgress(v); }}
          className="min-w-0 flex-1 accent-sky-500" />
        <select value={speed} onChange={(e) => setSpeed(parseFloat(e.target.value))}
          className="shrink-0 rounded-md bg-slate-800 px-1.5 py-1 text-xs text-slate-200 ring-1 ring-white/10">
          {[0.25, 0.5, 1, 2, 4].map((s) => <option key={s} value={s}>{s === 0.25 ? '¼×' : s === 0.5 ? '½×' : `${s}×`}</option>)}
        </select>
      </div>

      {countdown !== null && countdown > 0 && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <span key={countdown} style={{ animation: 'fp-cd 0.9s ease-out' }}
            className="text-8xl font-black tabular-nums text-white drop-shadow-[0_2px_14px_rgba(0,0,0,0.85)]">
            {countdown}
          </span>
        </div>
      )}
      <style>{'@keyframes fp-cd{0%{transform:scale(1.9);opacity:0}25%{opacity:1}100%{transform:scale(1);opacity:.92}}'}</style>
    </div>
  );
}

/**
 * Follow-cam. When `follow` is on, frames the flying model and tracks it by
 * translating the camera + orbit target by the model's per-frame delta (so the
 * user can still orbit/zoom relative to the rocket). When off, snaps back to a
 * whole-arc overview. Re-frames whenever the mode flips.
 */
function CamRig({ follow, point, dist, midY, home }: { follow: boolean; point: THREE.Vector3; dist: number; midY: number; home: THREE.Vector3 }) {
  const controls = useThree((s) => s.controls) as { target: THREE.Vector3; object: THREE.Object3D; update: () => void } | null;
  const prev = useRef<THREE.Vector3 | null>(null);
  const mode = useRef<boolean | null>(null);
  useFrame(() => {
    if (!controls) return;
    if (mode.current !== follow) {
      mode.current = follow;
      if (follow) {
        controls.target.copy(point);
        controls.object.position.set(point.x + dist * 0.55, point.y + dist * 0.32, point.z + dist);
        prev.current = point.clone();
      } else {
        controls.target.set(0, midY, 0);
        controls.object.position.copy(home);
        prev.current = null;
      }
      controls.update();
      return;
    }
    if (follow && prev.current) {
      const d = new THREE.Vector3().subVectors(point, prev.current);
      if (d.lengthSq() > 1e-9) { controls.object.position.add(d); controls.target.add(d); controls.update(); }
      prev.current.copy(point);
    }
  });
  return null;
}

/** Rocket-blast flame: the cone's POINT sits at the nozzle and it flares WIDE below,
 *  hottest (white) at the tip, orange out at the flared base. Vertex-coloured along the
 *  local +X (trailing) axis so its orientation is fixed by construction. */
function Flame({ len, r }: { len: number; r: number }) {
  const ref = useRef<THREE.Mesh>(null);
  const geo = useMemo(() => {
    const H = r * 5.5;
    const g = new THREE.ConeGeometry(r * 0.95, H, 24, 1, true); // open cone, apex +Y, base −Y
    g.rotateZ(Math.PI / 2); // apex → −X, base → +X
    g.translate(H / 2, 0, 0); // apex (point) at origin/nozzle, base (wide) at +X (trailing)
    const pos = g.attributes.position;
    const hot = new THREE.Color('#fff4cf'), mid = new THREE.Color('#ffb020'), edge = new THREE.Color('#ff4d10');
    const col: number[] = [];
    for (let i = 0; i < pos.count; i++) {
      const u = THREE.MathUtils.clamp(pos.getX(i) / H, 0, 1); // 0 at nozzle-point → 1 at flared base
      const c = u < 0.5 ? hot.clone().lerp(mid, u / 0.5) : mid.clone().lerp(edge, (u - 0.5) / 0.5);
      col.push(c.r, c.g, c.b);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return g;
  }, [r]);
  useEffect(() => () => geo.dispose(), [geo]);
  useFrame(({ clock }) => {
    if (ref.current) ref.current.scale.set(1 + 0.25 * Math.sin(clock.elapsedTime * 31), 1 + 0.09 * Math.sin(clock.elapsedTime * 44), 1 + 0.09 * Math.sin(clock.elapsedTime * 44));
  });
  return (
    <mesh ref={ref} geometry={geo} position={[len, 0, 0]}>
      <meshBasicMaterial vertexColors transparent opacity={0.9} depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} />
    </mesh>
  );
}

/** Canopy (hemisphere) + shroud lines, sized to the real chute diameter. */
function Parachute({ attach, radius, color }: { attach: THREE.Vector3; radius: number; color: string }) {
  const drop = radius * 1.4;
  const strings = useMemo(() => Array.from({ length: 6 }, (_, i) => {
    const a = (i / 6) * Math.PI * 2;
    return [[Math.cos(a) * radius, 0, Math.sin(a) * radius], [0, -drop, 0]] as [number, number, number][];
  }), [radius, drop]);
  return (
    <group position={[attach.x, attach.y + drop, attach.z]}>
      <mesh>
        <sphereGeometry args={[radius, 22, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={color} side={THREE.DoubleSide} transparent opacity={0.92} roughness={0.85} />
      </mesh>
      {strings.map((pts, i) => <Line key={i} points={pts} color="#d9e4ec" lineWidth={1} transparent opacity={0.7} />)}
    </group>
  );
}

/** A fluttering ribbon streamer trailing above the rocket. */
function Streamer({ attach, length, width, color }: { attach: THREE.Vector3; length: number; width: number; color: string }) {
  const w = Math.max(0.15, width), L = Math.max(1.5, length);
  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(w, L, 1, 14);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      pos.setZ(i, Math.sin((y / L) * Math.PI * 4) * w * 0.9); // static flutter
    }
    g.computeVertexNormals();
    return g;
  }, [w, L]);
  return (
    <group position={[attach.x, attach.y + L / 2, attach.z]}>
      <mesh geometry={geo} rotation={[0, 0.5, 0]}>
        <meshStandardMaterial color={color} side={THREE.DoubleSide} roughness={0.8} metalness={0} />
      </mesh>
    </group>
  );
}

function Marker({ pos, color }: { pos: THREE.Vector3; color: string }) {
  return (
    <mesh position={pos}>
      <sphereGeometry args={[0.22, 14, 14]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.4} />
    </mesh>
  );
}

function Hud({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex flex-col leading-tight">
      <span className="text-[9px] uppercase tracking-wide text-slate-400">{label}</span>
      <span className="font-semibold tabular-nums text-slate-100">{value}</span>
    </span>
  );
}

/** Legend row that doubles as the phase-colour editor — click the swatch to recolour. */
function Legend({ color, label, onChange }: { color: string; label: string; onChange: (c: string) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-1.5 text-slate-300" title={label}>
      <input
        type="color" value={color} onChange={(e) => onChange(e.target.value)}
        className="h-3 w-3 cursor-pointer appearance-none rounded-sm border border-white/20 bg-transparent p-0"
        style={{ background: color }}
      />
      {label}
    </label>
  );
}
