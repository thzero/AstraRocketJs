import { memo, useCallback, useEffect, useMemo, useRef, useState, type ComponentRef, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Line, Html } from '@react-three/drei';
import type { ComponentNode, FlightResult, RocketTree } from '../../engine/openRocketEngine';
import { num } from '../../tree/nodeProps';
import { buildPieces, type Piece } from './Rocket3D';
import { colorForType, mergePalette, type PartPalette } from '../../services/partColors';
import { useSettings } from '../../state/SettingsProvider';
import { fmtNum } from '../../i18n/format';
import { useUnits } from '../../prefs/useUnits';
import { EVENT_LABEL } from '../../services/simReport';
import { buildFlightScene, indexForProgress, modelPoseAt, newModelPose, type FlightScene } from './flightScene';
import { colorOf, type MotorDims } from './schematicGeometry';
import { FlightGroundMap } from './FlightGroundMap';
import { TILE_SOURCES, type TileSourceId } from '../../services/slippyMap';
import { groundImagery, rememberGroundImagery, rememberTileLayer, tileLayer } from '../../services/tileLayer';
import { MIN_EXTENT_M } from '../../services/groundTrack';

/**
 * 3D flight path (adapted from Vector Celeste's Flight3D, one better). Draws the
 * REAL trajectory (Px/Py drift × altitude) as a phase-colored arc over a ground
 * plane, with the actual design model flying along it (buildPieces) — sitting on
 * the pad at launch, nose-along-velocity during boost/coast (with a layered motor
 * flame), then hanging under its actual recovery device (parachute sized to its
 * real diameter, or a streamer, or nothing) on descent. Event callouts, a live
 * HUD, and play · scrub · speed transport.
 *
 * Two clocks. The ANIMATION runs inside the canvas (`Playback`, a `useFrame`
 * subscriber) and drives the model, flame, recovery device, trail and follow
 * camera by mutating them from `progressRef`, so a frame costs a binary search
 * and a few vector copies. REACT only hears about it at HUD_INTERVAL_MS: the
 * slider, the readouts, the markers and the callouts re-render from the
 * throttled `progress` state. The previous shape called setState from a rAF
 * loop and re-rendered this whole tree - every piece mesh, every callout, a
 * fresh Vector3/Quaternion pair, three new legend callbacks - sixty times a
 * second, and needed a render-time ref cache just to keep the trail geometry
 * from being re-uploaded per frame.
 */
const MODEL_LEN = 1.6; // scene units the rocket model is scaled to — kept small vs the ~24u arc; the follow-cam makes it readable
const PLAY_SECONDS = 8; // wall-clock length of a full 1× playback (time-based, so boost isn't slow)
/** How often the frame loop hands React a progress sample for the HUD/slider. */
const HUD_INTERVAL_MS = 100;
const SPEEDS = [0.25, 0.5, 1, 2, 4];

type Recovery =
  | { kind: 'parachute'; diameter: number; color: string }
  | { kind: 'streamer'; length: number; width: number; color: string }
  | null;
function findRecovery(tree: RocketTree, palette: PartPalette): Recovery {
  let found: Recovery = null;
  const recColor = (n: ComponentNode) => colorOf(n, colorForType(n.type, palette));
  const walk = (nodes: ComponentNode[]) => {
    for (const n of nodes) {
      if (!found && n.type === 'parachute')
        found = { kind: 'parachute', diameter: num(n, 'diameter', 0.3), color: recColor(n) };
      else if (!found && n.type === 'streamer')
        found = {
          kind: 'streamer',
          length: num(n, 'stripLength', 0.4),
          width: num(n, 'stripWidth', 0.05),
          color: recColor(n),
        };
      if (n.children) walk(n.children);
    }
  };
  walk(tree.components);
  return found;
}

/**
 * The three layer buttons, spelled out rather than built from a variable, which
 * is invisible to the i18n key-coverage test. Same set and same session memory
 * as the ground track's.
 */
const LAYERS = [
  { id: 'off', labelKey: 'map.none' },
  { id: 'satellite', labelKey: 'map.satellite' },
  { id: 'street', labelKey: 'map.street' },
] as const satisfies readonly { id: 'off' | TileSourceId; labelKey: string }[];

/**
 * How far past the flight's own reach the ground map extends.
 *
 * A margin rather than the whole ground plane: the plane and its grid are a
 * fixed 60 units however far the rocket went, so covering them meant fetching
 * imagery for a kilometer of ground either side of a three-hundred-meter
 * flight. Enough that the arc never runs off the edge of the map, and the tile
 * grid's own rounding to whole tiles usually adds most of another one anyway.
 */
const GROUND_MARGIN = 1.2;

export function FlightPath3D({
  result,
  tree,
  motors,
  latitudeDeg,
  longitudeDeg,
}: {
  result: FlightResult;
  tree: RocketTree;
  motors?: MotorDims;
  /** The site this flight was flown from; null only if it was never filled in. */
  latitudeDeg?: number | null;
  longitudeDeg?: number | null;
}) {
  const { t } = useTranslation();
  const u = useUnits();
  const { settings, update } = useSettings();
  const palette = useMemo(() => mergePalette(settings.partColors), [settings.partColors]);
  const phase = settings.phaseColors; // boost/coast/descent colors, from Settings
  // The HUD/slider copy of playback progress. The frame loop owns the live
  // value (progressRef) and refreshes this one at HUD_INTERVAL_MS; a scrub
  // writes both at once.
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(false); // start on the pad; play → countdown → launch
  const [speed, setSpeed] = useState(settings.playbackSpeed); // seeded from the Settings default
  const [follow, setFollow] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [loop, setLoop] = useState(false);
  const progressRef = useRef(0);
  /**
   * Which imagery lies on the ground, shared with the site map and the ground
   * track for the session (services/tileLayer.ts) so "satellite or street" is
   * one answer across the app.
   */
  const [layer, setLayer] = useState<'off' | TileSourceId>(() => (groundImagery() ? tileLayer() : 'off'));
  const [unreachable, setUnreachable] = useState(false);
  const onUnavailable = useCallback(() => setUnreachable(true), []);
  const pickLayer = (next: 'off' | TileSourceId) => {
    rememberGroundImagery(next !== 'off');
    if (next !== 'off') rememberTileLayer(next);
    // A failed verdict is dropped, so pressing the layer you are already on is
    // a retry rather than a button that does nothing.
    setUnreachable(false);
    setLayer(next);
  };
  // Scene objects the frame loop mutates directly.
  const modelRef = useRef<THREE.Group>(null);
  const flameRef = useRef<THREE.Group>(null);
  const recoveryRef = useRef<THREE.Group>(null);
  const trailRef = useRef<ComponentRef<typeof Line>>(null);
  // Stable, so React attaches it once rather than re-running it (and hiding
  // the trail again) on every HUD tick. The loop reveals the trail from here.
  const attachTrail = useCallback((line: ComponentRef<typeof Line> | null) => {
    trailRef.current = line;
    if (line) line.visible = false;
  }, []);

  const { pieces, totalLen, maxR } = useMemo(() => buildPieces(tree, motors, palette), [tree, motors, palette]);
  useEffect(
    () => () => {
      for (const p of pieces) p.geometry.dispose();
    },
    [pieces],
  );
  const modelScale = MODEL_LEN / Math.max(totalLen, 0.05);
  const recovery = useMemo(() => findRecovery(tree, palette), [tree, palette]);

  const scene = useMemo(() => buildFlightScene(result, phase), [result, phase]);
  const { colors, scenePts, apogeeIdx, times, alts, vels, callouts } = scene;
  const n = scenePts.length;

  // Camera framing derives from the trajectory's peak. A loop, not
  // Math.max(...spread), to survive long flights; memoized on the points so it
  // is not re-walked on every HUD tick.
  const maxY = useMemo(() => {
    let m = 0;
    for (const p of scenePts) if (p.y > m) m = p.y;
    return m;
  }, [scenePts]);
  const home = useMemo(() => new THREE.Vector3(maxY * 1.15, maxY * 0.62, maxY * 1.4), [maxY]);
  const midY = maxY / 2;
  const followDist = MODEL_LEN * 3.4;

  // The HUD's sample, from the throttled progress copy. Every hook sits above
  // the empty-state return below so the hook count never changes.
  const idx = useMemo(() => indexForProgress(times, progress), [times, progress]);
  const nowT = times[idx] ?? 0;
  const shownCallouts = useMemo(() => callouts.filter((c) => nowT >= c.time), [callouts, nowT]);

  // T-minus countdown before the initial launch: 5→4→3→2→1, then play from
  // t=0. The launch happens INSIDE the timer callback rather than in a
  // follow-up effect keyed on `countdown <= 0`, so it is one state commit and
  // there is no intermediate render showing "0".
  useEffect(() => {
    if (countdown === null) return;
    const id = setTimeout(() => {
      if (countdown > 1) {
        setCountdown(countdown - 1);
        return;
      }
      setCountdown(null);
      progressRef.current = 0;
      setProgress(0);
      setPlaying(true);
    }, 900);
    return () => clearTimeout(id);
  }, [countdown]);

  /** Scrub: the live value and the HUD copy move together. */
  const seek = useCallback((v: number) => {
    progressRef.current = v;
    setProgress(v);
  }, []);
  // Stable callbacks for the frame loop and the legend, so neither re-subscribes
  // per render.
  const onTick = useCallback((p: number) => setProgress(p), []);
  const onEnd = useCallback(() => setPlaying(false), []);
  const setBoost = useCallback((c: string) => update({ phaseColors: { ...phase, boost: c } }), [update, phase]);
  const setCoast = useCallback((c: string) => update({ phaseColors: { ...phase, coast: c } }), [update, phase]);
  const setDescent = useCallback((c: string) => update({ phaseColors: { ...phase, descent: c } }), [update, phase]);

  const handlePlay = () => {
    if (countdown !== null) {
      setCountdown(null);
      return;
    } // cancel a running countdown
    if (playing) {
      setPlaying(false);
      return;
    }
    // The live value, not the throttled copy: the copy can lag by a tick.
    const p = progressRef.current;
    if (p <= 0.001 || p >= 0.999)
      setCountdown(5); // fresh launch (from pad or after landing)
    else setPlaying(true); // resume from a paused mid-flight
  };
  const handleReset = () => {
    setPlaying(false);
    setCountdown(null);
    seek(0);
  };

  /**
   * How much ground the map has to cover: the furthest the rocket got from the
   * pad on either horizontal axis, plus a margin.
   *
   * Floored at the same {@link MIN_EXTENT_M} the ground track uses, because it
   * is the same question - a still-air flight lands on the pad, and a map of
   * ten centimeters of grass is no map at all.
   */
  const groundRadiusM = useMemo(() => {
    let far = 0;
    for (const p of scenePts) {
      const d = Math.max(Math.abs(p.x), Math.abs(p.z));
      if (d > far) far = d;
    }
    return Math.max(MIN_EXTENT_M, (far / scene.unitsPerMeter) * GROUND_MARGIN);
  }, [scenePts, scene.unitsPerMeter]);

  const site = latitudeDeg != null && longitudeDeg != null ? { lat: latitudeDeg, lon: longitudeDeg } : null;
  const mapSource: TileSourceId | null = site && layer !== 'off' && !unreachable ? layer : null;

  if (n < 2) {
    return <div className="grid h-full place-items-center text-sm text-slate-500">{t('sim.prompt')}</div>;
  }

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
        {/* Real ground under a real trajectory. Drawn between the plain ground
            plane and the grid, so the grid stays readable as the scale it is. */}
        {mapSource && site && (
          <FlightGroundMap
            latitudeDeg={site.lat}
            longitudeDeg={site.lon}
            radiusM={groundRadiusM}
            unitsPerMeter={scene.unitsPerMeter}
            source={mapSource}
            onUnavailable={onUnavailable}
          />
        )}
        <gridHelper args={[120, 60, '#33506a', '#18293a']} position={[0, 0.02, 0]} />
        {/* The whole path is uploaded ONCE; the frame loop reveals it segment by
            segment through the geometry's instanceCount (a Line2 is instanced,
            one instance per segment), so no buffer is rebuilt during playback.
            Hidden on mount through the ref, NOT a `visible` prop: drei's Line
            spreads its rest props onto the material as well, and a material
            with visible=false is never drawn, whatever the loop later sets on
            the object. */}
        <Line ref={attachTrail} points={scenePts} vertexColors={colors} lineWidth={3} />
        <Marker pos={scenePts[0]!} color="#e2e8f0" />
        {idx >= apogeeIdx && <Marker pos={scenePts[apogeeIdx]!} color={phase.coast} />}
        {idx >= n - 1 && <Marker pos={scenePts[n - 1]!} color={phase.descent} />}

        {shownCallouts.map((c) => (
          // Keyed by identity, not array index: the filtered list grows as the
          // flight plays, so index keys remounted every existing callout each
          // time a new one appeared.
          <Html
            key={`${c.type}@${c.time}`}
            position={[c.pos.x, c.pos.y, c.pos.z]}
            center
            // drei's default range starts at 16,777,271, which put every callout
            // above every dialog in the app (they sit at z-50 to z-70): a
            // "Burnout" tag drew through the Design Report. Keep the labels
            // above the canvas and below anything modal.
            zIndexRange={[10, 0]}
            style={{ pointerEvents: 'none' }}
          >
            <div
              data-flight-callout
              className="whitespace-nowrap rounded bg-slate-900/85 px-1.5 py-0.5 text-[10px] font-medium text-amber-300 ring-1 ring-white/10"
            >
              {t(EVENT_LABEL[c.type] ?? c.type)}
            </div>
          </Html>
        ))}

        <FlyingModel
          groupRef={modelRef}
          flameRef={flameRef}
          pieces={pieces}
          totalLen={totalLen}
          maxR={maxR}
          modelScale={modelScale}
        />

        {/* The recovery device hangs from the nose; the loop places this group
            there and shows it once the flight is descending. */}
        <group ref={recoveryRef} visible={false}>
          {recovery?.kind === 'parachute' && <Parachute radius={chuteR} color={recovery.color} />}
          {recovery?.kind === 'streamer' && (
            <Streamer
              length={recovery.length * modelScale}
              width={recovery.width * modelScale}
              color={recovery.color}
            />
          )}
        </group>

        <OrbitControls
          makeDefault
          enableDamping={!follow}
          maxPolarAngle={Math.PI * 0.495}
          minDistance={3}
          maxDistance={160}
        />
        <Playback
          scene={scene}
          playing={playing}
          speed={speed}
          loop={loop}
          progressRef={progressRef}
          modelRef={modelRef}
          flameRef={flameRef}
          recoveryRef={recoveryRef}
          trailRef={trailRef}
          follow={follow}
          home={home}
          midY={midY}
          followDist={followDist}
          onTick={onTick}
          onEnd={onEnd}
        />
      </Canvas>

      <div className="pointer-events-none absolute left-3 top-3 flex gap-3 rounded-lg bg-slate-900/80 px-3 py-2 text-xs ring-1 ring-white/10">
        <Hud label={t('flight.altitude')} value={`${u.fmt('distance', alts[idx] ?? 0)} ${u.sym('distance')}`} />
        <Hud label={t('flight.velocity')} value={`${u.fmt('velocity', vels[idx] ?? 0)} ${u.sym('velocity')}`} />
        <Hud label={t('flight.time')} value={`${fmtNum(nowT, 1)} s`} />
      </div>
      <div className="pointer-events-none absolute right-3 top-3 flex flex-col gap-1 rounded-lg bg-slate-900/80 px-2 py-1.5 text-[10px] ring-1 ring-white/10">
        <Legend color={phase.boost} label={t('flight.boost')} onChange={setBoost} />
        <Legend color={phase.coast} label={t('flight.coast')} onChange={setCoast} />
        <Legend color={phase.descent} label={t('flight.descent')} onChange={setDescent} />
      </div>
      {/* Offered only where there is a coordinate to center the ground on. */}
      {site && (
        <div className="absolute left-3 top-16 flex overflow-hidden rounded-md ring-1 ring-black/40">
          {LAYERS.map((l) => (
            <button
              key={l.id}
              onClick={() => pickLayer(l.id)}
              aria-pressed={layer === l.id}
              className={`px-2 py-1 text-[11px] font-medium ${
                layer === l.id ? 'bg-sky-600 text-white' : 'bg-slate-900/80 text-slate-300 hover:bg-slate-800'
              }`}
            >
              {t(l.labelKey)}
            </button>
          ))}
        </div>
      )}
      {/* A condition of using the tiles at all, so it goes wherever they do. */}
      {mapSource && (
        <p className="pointer-events-none absolute bottom-16 right-3 bg-slate-900/70 px-1 text-[9px] leading-tight text-slate-400">
          {TILE_SOURCES[mapSource].attribution}
        </p>
      )}
      {site && layer !== 'off' && unreachable && (
        <p className="pointer-events-none absolute bottom-16 right-3 bg-slate-900/70 px-1 text-[9px] leading-tight text-amber-400">
          {t('map.offline')}
        </p>
      )}

      <div className="absolute inset-x-3 bottom-3 flex items-center gap-2 rounded-lg bg-slate-900/85 px-3 py-2 ring-1 ring-white/10">
        <button
          onClick={handlePlay}
          aria-label={countdown !== null ? t('flight.cancel') : playing ? t('flight.pause') : t('flight.play')}
          className="shrink-0 rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-200 ring-1 ring-white/10 hover:bg-slate-700"
        >
          {countdown !== null ? '✕' : playing ? '⏸' : '▶'}
        </button>
        <button
          onClick={handleReset}
          title={t('flight.reset')}
          className="shrink-0 rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-200 ring-1 ring-white/10 hover:bg-slate-700"
        >
          ⟲
        </button>
        <button
          onClick={() => setLoop((l) => !l)}
          title={t('flight.loop')}
          className={`shrink-0 rounded-md px-2 py-1 text-xs ring-1 ring-white/10 ${loop ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'}`}
        >
          ⟳
        </button>
        <button
          onClick={() => setFollow((f) => !f)}
          title={t('flight.follow')}
          className={`shrink-0 rounded-md px-2 py-1 text-xs ring-1 ring-white/10 ${follow ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'}`}
        >
          ⊙ {t('flight.follow')}
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={progress}
          onChange={(e) => {
            setPlaying(false);
            seek(parseFloat(e.target.value));
          }}
          className="min-w-0 flex-1 accent-sky-500"
        />
        <select
          value={speed}
          onChange={(e) => setSpeed(parseFloat(e.target.value))}
          className="shrink-0 rounded-md bg-slate-800 px-1.5 py-1 text-xs text-slate-200 ring-1 ring-white/10"
        >
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s === 0.25 ? '¼×' : s === 0.5 ? '½×' : `${s}×`}
            </option>
          ))}
        </select>
      </div>

      {countdown !== null && countdown > 0 && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <span
            key={countdown}
            style={{ animation: 'fp-cd 0.9s ease-out' }}
            className="text-8xl font-black tabular-nums text-white drop-shadow-[0_2px_14px_rgba(0,0,0,0.85)]"
          >
            {countdown}
          </span>
        </div>
      )}
      <style>
        {'@keyframes fp-cd{0%{transform:scale(1.9);opacity:0}25%{opacity:1}100%{transform:scale(1);opacity:.92}}'}
      </style>
    </div>
  );
}

type OrbitLike = { target: THREE.Vector3; object: THREE.Object3D; update: () => void } | null;

/**
 * The frame loop. Advances `progressRef` while playing (time-based, so a
 * fast boost is not slow), poses the model for that instant, reveals the
 * trail, drives the follow camera, and hands React a throttled progress sample
 * for the HUD. Everything it touches is a ref: a frame never renders React.
 *
 * Follow-cam: when `follow` is on, frames the flying model and tracks it by
 * translating the camera + orbit target by the model's per-frame delta (so the
 * user can still orbit/zoom relative to the rocket). When off, snaps back to a
 * whole-arc overview. Re-frames whenever the mode flips.
 */
function Playback({
  scene,
  playing,
  speed,
  loop,
  progressRef,
  modelRef,
  flameRef,
  recoveryRef,
  trailRef,
  follow,
  home,
  midY,
  followDist,
  onTick,
  onEnd,
}: {
  scene: FlightScene;
  playing: boolean;
  speed: number;
  loop: boolean;
  progressRef: RefObject<number>;
  modelRef: RefObject<THREE.Group | null>;
  flameRef: RefObject<THREE.Group | null>;
  recoveryRef: RefObject<THREE.Group | null>;
  trailRef: RefObject<ComponentRef<typeof Line> | null>;
  follow: boolean;
  home: THREE.Vector3;
  midY: number;
  followDist: number;
  onTick: (progress: number) => void;
  onEnd: () => void;
}) {
  const controls = useThree((s) => s.controls) as OrbitLike;
  const pose = useMemo(() => newModelPose(), []);
  const camPrev = useRef<THREE.Vector3 | null>(null);
  const camMode = useRef<boolean | null>(null);
  const hud = useRef({ at: 0, idx: -1 });
  const camDelta = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, dt) => {
    const { scenePts, times, deployT, burnoutT } = scene;
    const n = scenePts.length;
    let p = progressRef.current;
    let ended = false;
    if (playing && n >= 2) {
      p += (dt * speed) / PLAY_SECONDS;
      if (p >= 1) {
        if (loop)
          p -= 1; // wrap → keep flying
        else {
          p = 1;
          ended = true; // stop at landing
        }
      }
      progressRef.current = p;
    }

    const idx = indexForProgress(times, p);
    const nowT = times[idx] ?? 0;
    const descending = nowT >= deployT;
    modelPoseAt(scenePts, idx, descending, MODEL_LEN, pose);
    const model = modelRef.current;
    if (model) {
      model.position.copy(pose.position);
      model.quaternion.copy(pose.quaternion);
    }
    if (flameRef.current) flameRef.current.visible = nowT < burnoutT;
    const rec = recoveryRef.current;
    if (rec) {
      rec.visible = descending;
      rec.position.copy(pose.nose);
    }
    const trail = trailRef.current;
    if (trail) {
      // Reveal the path only where the rocket has already flown: `idx`
      // segments out of the n-1 the geometry holds.
      trail.visible = idx >= 1;
      (trail.geometry as THREE.InstancedBufferGeometry).instanceCount = Math.max(0, Math.min(idx, n - 1));
    }

    // Camera.
    const point = scenePts[idx];
    if (controls && point) {
      if (camMode.current !== follow) {
        camMode.current = follow;
        if (follow) {
          controls.target.copy(point);
          controls.object.position.set(point.x + followDist * 0.55, point.y + followDist * 0.32, point.z + followDist);
          camPrev.current = point.clone();
        } else {
          controls.target.set(0, midY, 0);
          controls.object.position.copy(home);
          camPrev.current = null;
        }
        controls.update();
      } else if (follow && camPrev.current) {
        camDelta.subVectors(point, camPrev.current);
        if (camDelta.lengthSq() > 1e-9) {
          controls.object.position.add(camDelta);
          controls.target.add(camDelta);
          controls.update();
        }
        camPrev.current.copy(point);
      }
    }

    // Throttled HUD sample: on a timer while playing, plus the landing frame.
    if (ended) {
      hud.current = { at: performance.now(), idx };
      onTick(p);
      onEnd();
    } else if (playing) {
      const now = performance.now();
      if (now - hud.current.at >= HUD_INTERVAL_MS || (idx === n - 1 && hud.current.idx !== idx)) {
        hud.current = { at: now, idx };
        onTick(p);
      }
    }
  });
  return null;
}

/**
 * The actual design model, flying along the path. Memoized: its parent
 * re-renders on every HUD tick, and this is the one subtree with a mesh per
 * piece. The frame loop moves it through `groupRef` and lights the flame
 * through `flameRef`.
 */
const FlyingModel = memo(function FlyingModel({
  groupRef,
  flameRef,
  pieces,
  totalLen,
  maxR,
  modelScale,
}: {
  groupRef: RefObject<THREE.Group | null>;
  flameRef: RefObject<THREE.Group | null>;
  pieces: Piece[];
  totalLen: number;
  maxR: number;
  modelScale: number;
}) {
  return (
    <group ref={groupRef} scale={modelScale}>
      <group position={[-totalLen / 2, 0, 0]}>
        {pieces.map((p) => (
          <mesh key={p.key} geometry={p.geometry} position={p.position ?? [0, 0, 0]} rotation={p.rotation ?? [0, 0, 0]}>
            <meshStandardMaterial color={p.color} roughness={0.55} metalness={0.1} />
          </mesh>
        ))}
        <group ref={flameRef} visible={false}>
          <Flame len={totalLen} r={maxR} />
        </group>
      </group>
    </group>
  );
});

/** Rocket-blast flame: the cone's POINT sits at the nozzle and it flares WIDE below,
 *  hottest (white) at the tip, orange out at the flared base. Vertex-colored along the
 *  local +X (trailing) axis so its orientation is fixed by construction. */
function Flame({ len, r }: { len: number; r: number }) {
  const ref = useRef<THREE.Mesh>(null);
  const geo = useMemo(() => {
    const H = r * 5.5;
    const g = new THREE.ConeGeometry(r * 0.95, H, 24, 1, true); // open cone, apex +Y, base −Y
    g.rotateZ(Math.PI / 2); // apex → −X, base → +X
    g.translate(H / 2, 0, 0); // apex (point) at origin/nozzle, base (wide) at +X (trailing)
    const pos = g.attributes.position!;
    const hot = new THREE.Color('#fff4cf'),
      mid = new THREE.Color('#ffb020'),
      edge = new THREE.Color('#ff4d10');
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
    if (ref.current)
      ref.current.scale.set(
        1 + 0.25 * Math.sin(clock.elapsedTime * 31),
        1 + 0.09 * Math.sin(clock.elapsedTime * 44),
        1 + 0.09 * Math.sin(clock.elapsedTime * 44),
      );
  });
  return (
    <mesh ref={ref} geometry={geo} position={[len, 0, 0]}>
      <meshBasicMaterial
        vertexColors
        transparent
        opacity={0.9}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

/** Canopy (hemisphere) + shroud lines, sized to the real chute diameter.
 *  Local origin = the attachment point (the nose); the canopy sits `drop` above. */
function Parachute({ radius, color }: { radius: number; color: string }) {
  const drop = radius * 1.4;
  const strings = useMemo(
    () =>
      Array.from({ length: 6 }, (_, i) => {
        const a = (i / 6) * Math.PI * 2;
        return [
          [Math.cos(a) * radius, 0, Math.sin(a) * radius],
          [0, -drop, 0],
        ] as [number, number, number][];
      }),
    [radius, drop],
  );
  return (
    <group position={[0, drop, 0]}>
      <mesh>
        <sphereGeometry args={[radius, 22, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={color} side={THREE.DoubleSide} transparent opacity={0.92} roughness={0.85} />
      </mesh>
      {strings.map((pts, i) => (
        <Line key={i} points={pts} color="#d9e4ec" lineWidth={1} transparent opacity={0.7} />
      ))}
    </group>
  );
}

/** A fluttering ribbon streamer trailing above the rocket (local origin = the nose). */
function Streamer({ length, width, color }: { length: number; width: number; color: string }) {
  const w = Math.max(0.15, width),
    L = Math.max(1.5, length);
  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(w, L, 1, 14);
    const pos = g.attributes.position!;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      pos.setZ(i, Math.sin((y / L) * Math.PI * 4) * w * 0.9); // static flutter
    }
    g.computeVertexNormals();
    return g;
  }, [w, L]);
  // R3F does not dispose geometry it did not construct, and this one is passed
  // in via the `geometry` prop. Every streamer-equipped design therefore leaked
  // one GPU buffer per unmount and per w/L change. Flame, CalloutLabel and
  // buildPieces all dispose; this was the omission.
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <group position={[0, L / 2, 0]}>
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

/** Legend row that doubles as the phase-color editor — click the swatch to recolor. */
function Legend({ color, label, onChange }: { color: string; label: string; onChange: (c: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  // The NATIVE `change` event: a color input fires it once, when the OS picker
  // closes with a new value, whereas React's `onChange` maps to `input` and
  // fires on every drag tick. Closing the picker with its own OK does not
  // always move focus, so blur alone left the swatch showing the old color
  // until something else took focus. `onChange` is a stable useCallback from
  // the parent, so this subscribes once per color rather than once per render.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const commit = () => {
      if (el.value !== color) onChange(el.value);
    };
    el.addEventListener('change', commit);
    return () => el.removeEventListener('change', commit);
  }, [color, onChange]);
  return (
    <label className="flex cursor-pointer items-center gap-1.5 text-slate-300" title={label}>
      <input
        ref={ref}
        type="color"
        // `defaultValue` + commit on blur or native change, not a controlled
        // per-`input` write. `onChange` on a color input fires continuously
        // while the OS picker is dragged, and each tick wrote the whole
        // settings object through the provider to persistent storage - dozens
        // of writes per gesture. PropertyPanel's color field defers the same way.
        defaultValue={color}
        key={color}
        onBlur={(e) => {
          if (e.target.value !== color) onChange(e.target.value);
        }}
        className="h-3 w-3 cursor-pointer appearance-none rounded-sm border border-white/20 bg-transparent p-0"
        style={{ background: color }}
      />
      {label}
    </label>
  );
}
