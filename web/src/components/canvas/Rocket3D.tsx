import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Bounds } from '@react-three/drei';
import type { RocketTree, StaticInfo } from '../../engine/openRocketEngine';
import type { ExportData } from '../../services/schematicExport.js';
import { mergePalette } from '../../services/partColors';
import { useSettings } from '../../state/SettingsProvider';
import { ImageExportMenu } from './ImageExportMenu.js';
import { useUnits } from '../../prefs/useUnits';
import type { MotorDims } from './schematicGeometry';
import { buildPieces, markerRadius } from './rocketPieces';
import { AxisCallout, markerTexture } from './rocketCallouts';
import { StabilityCallout } from './StabilityCallout';
import { RocketModel } from './RocketModel';
import { useRocketExport, type R3fHandles } from './useRocketExport';

// The store imports the motor-dims shape from here; the definition lives with
// the other shared view helpers.
export type { MotorDims } from './schematicGeometry';
// The geometry build and the export framing moved to their own modules; the
// flight path view, the OBJ exporter and Rocket3D.test.ts import them here.
export { buildPieces, piecesBounds, type Piece } from './rocketPieces';
export { exportCamera, fitCameraToBox, isFittableBox } from './rocketExportCamera';

/**
 * 3D rocket view (react-three-fiber). Geometry is generated from the
 * component tree: lathe profiles for nose cones and transitions (kernel-exact
 * shape math), cylinders for tubes, extruded shapes for fins placed at their
 * instance angles. The external shell is slightly translucent so motor mounts
 * and loaded motors read inside (S5), and a floating CG/CP callout hangs
 * beside the hull (2026-08-21c).
 * Rocket axis = +X (nose tip at x=0, aft increasing), matching the engine.
 *
 * This file is the composition: the geometry build (rocketPieces.ts), the
 * export framing (rocketExportCamera.ts), the export handler
 * (useRocketExport.ts), the mesh list (RocketModel.tsx) and the callouts
 * (rocketCallouts.tsx, StabilityCallout.tsx) each live in their own module.
 */

/** Highlight the active view preset (sky-600) to match the 2D preset buttons. */
const presetStyle = (active: boolean): import('react').CSSProperties =>
  active ? { background: '#0284c7', borderColor: '#0284c7', color: '#fff' } : {};

export function Rocket3D({
  tree,
  info,
  motors,
  exportData,
  selectedId,
  onSelect,
  showMarkers = true,
}: {
  tree: RocketTree;
  info: StaticInfo | null;
  /** Draw the CG/CP markers and callout (default true). */
  showMarkers?: boolean;
  /** Loaded motor cases keyed by mount node id — rendered seated at the
   *  mount's aft end, showing through the translucent shell (S5). */
  motors?: MotorDims;
  /** When set, a 📷 PNG snapshot button appears (issue 2026-08-11a). */
  exportData?: Omit<ExportData, 'spanM'>;
  /** Two-way selection sync with the component tree / 2D schematic. */
  selectedId?: string | null;
  onSelect?: (id: string) => void;
}) {
  const { t } = useTranslation();
  const u = useUnits();
  const { settings } = useSettings();
  const palette = useMemo(() => mergePalette(settings.partColors), [settings.partColors]);
  const { pieces, totalLen, maxR } = useMemo(() => buildPieces(tree, motors, palette), [tree, motors, palette]);
  const r3f = useRef<R3fHandles | null>(null);

  // Hi-res snapshot (issue 2026-08-11b): the same scene rendered offscreen at
  // the export width, with the on-screen path as the fallback.
  const snapshot = useRocketExport(r3f, pieces, maxR, exportData);
  // Mesh keys are stable across rebuilds, so R3F never unmounts/auto-disposes
  // the swapped-out geometries — release them ourselves or every edit leaks
  // a full set of GPU buffers.
  useEffect(
    () => () => {
      for (const p of pieces) p.geometry.dispose();
    },
    [pieces],
  );
  const center = totalLen / 2;
  const camDist = Math.max(totalLen * 1.1, maxR * 6, 0.25);
  const markerR = markerRadius(totalLen, maxR);
  const cgTex = useMemo(() => markerTexture('#2b6cff'), []);
  const cpTex = useMemo(() => markerTexture('#e34948'), []);
  useEffect(
    () => () => {
      cgTex.dispose();
      cpTex.dispose();
    },
    [cgTex, cpTex],
  );

  // View presets + recovery (batch 08-21d): a pan or deep zoom could lose the
  // rocket with no way back — these jump the camera to known-good stations.
  // OrbitControls re-derives its state from the camera, so setting position +
  // target + update() is the whole move.
  const controls = useRef<import('three-stdlib').OrbitControls | null>(null);
  // Mirror the 2D toggle EXACTLY: two persistent views (side / aft) with exactly
  // one always highlighted; Reset is a momentary re-fit of the current view and
  // is never highlighted. (No third "3/4" preset — 2D has only two views.)
  const [preset, setPreset] = useState<'side' | 'aft'>('side');
  const sidePos: [number, number, number] = [center, 0, camDist * 1.05];
  const aftPos: [number, number, number] = [totalLen + camDist * 0.9, 0, 0];
  const moveCam = (pos: [number, number, number]) => {
    const st = r3f.current;
    const c = controls.current;
    if (!st || !c) return;
    st.camera.position.set(pos[0], pos[1], pos[2]);
    c.target.set(center, 0, 0);
    c.update();
  };
  const showView = (which: 'side' | 'aft') => {
    setPreset(which);
    moveCam(which === 'side' ? sidePos : aftPos);
  };
  const resetView = () => moveCam(preset === 'side' ? sidePos : aftPos);

  return (
    <div
      className="rocket3d-wrap"
      style={{ position: 'relative', height: '100%', minHeight: 320, display: 'flex', flexDirection: 'column' }}
    >
      {exportData && (
        <div style={{ position: 'absolute', top: 6, right: 6, zIndex: 2 }}>
          <ImageExportMenu
            label={`📷 ${t('export.image')}`}
            fitOption
            title={t('export.imageTitle3d')}
            onPick={snapshot}
          />
        </div>
      )}
      {/* Default to top-RIGHT so the quick-glance info card can sit top-left in
          the same spot as the 2D view. In image-export contexts the 📷 menu owns
          the top-right, so fall back to top-left there (no info card is shown). */}
      <div
        style={{
          position: 'absolute',
          top: 6,
          ...(exportData ? { left: 6 } : { right: 6 }),
          zIndex: 2,
          display: 'flex',
          gap: 6,
        }}
      >
        <button className="file-btn" title={t('view.reset3dTitle')} onClick={resetView}>
          {t('view.reset')}
        </button>
        <button
          className="file-btn"
          style={presetStyle(preset === 'side')}
          title={t('view.sideTitle')}
          onClick={() => showView('side')}
        >
          {t('view.side')}
        </button>
        <button
          className="file-btn"
          style={presetStyle(preset === 'aft')}
          title={t('view.aftTitle')}
          onClick={() => showView('aft')}
        >
          {t('view.aft')}
        </button>
      </div>
      <Canvas
        // Measure the LAYOUT box, not the painted one. On a portrait phone the
        // Sketch pane is turned a quarter turn, and r3f's default measurement
        // (getBoundingClientRect) reports a rotated element's axis-aligned
        // screen box — so a 658x325 host came back as 325x658 and the camera was
        // framed at aspect 0.49 instead of 2.02, drawing the rocket four times
        // too big and clipped. offsetWidth/offsetHeight ignore transforms.
        resize={{ offsetSize: true }}
        style={{ flex: '1 1 0%', minHeight: 0 }}
        camera={{ position: [center, 0, camDist * 1.05], fov: 40 }}
        // The export's live-canvas FALLBACK reads the drawing buffer after the
        // frame — without this flag WebGL may have discarded it and drawImage
        // returns black. The preferred offscreen path does not need it.
        gl={{ preserveDrawingBuffer: true }}
        onCreated={(state) => {
          r3f.current = { gl: state.gl, scene: state.scene, camera: state.camera, setFrameloop: state.setFrameloop };
        }}
      >
        {/* Soft studio setup (S5): warm-neutral key, cool fill, low rim —
            subtle and blueprint-serious, no shadows or environment maps. */}
        <ambientLight intensity={0.55} />
        <directionalLight position={[1.5, 2.5, 2]} intensity={0.95} color="#fff7ee" />
        <directionalLight position={[-2, 0.5, -1]} intensity={0.45} color="#e8eef8" />
        <directionalLight position={[-0.5, -1.5, -2.5]} intensity={0.35} />
        <Bounds fit clip observe margin={1.1}>
          <group>
            <RocketModel pieces={pieces} selectedId={selectedId} onSelect={onSelect} />
            {/* CG/CP sit on the rocket axis — inside the shell — so they must
              render ON TOP (depthTest off, high renderOrder) to be visible,
              exactly like the 2D markers. `transparent` puts them in the
              transparent queue AFTER the see-through shell, or the shell
              would wash over them. */}
            {/* 0.45× the shared size rule (batch 08-21d): full-size axis balls
              overwhelmed small rockets; the gadget keeps the size rule. */}
            {showMarkers && info && Number.isFinite(info.cg) && (
              <AxisCallout
                x={info.cg}
                dir={1}
                color="#dbe3ea"
                tex={cgTex}
                label={`${t('schematic.cg')} · ${u.fmt('length', info.cg)} ${u.sym('length')}`}
                len={maxR * 1.7}
                markerR={markerR}
              />
            )}
            {showMarkers && info && Number.isFinite(info.cp) && (
              <StabilityCallout info={info} maxR={maxR} markerR={markerR} tex={cpTex} />
            )}
          </group>
        </Bounds>
        {/* Distance limits (batch 08-21d): an unbounded zoom could bury the
            camera inside the hull or fling it to where the rocket is a pixel;
            the view buttons above are the recovery path either way. */}
        <OrbitControls
          makeDefault
          ref={controls}
          target={[center, 0, 0]}
          enableDamping
          dampingFactor={0.1}
          minDistance={camDist * 0.12}
          maxDistance={camDist * 5}
        />
      </Canvas>
      <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '4px 0 0', textAlign: 'center' }}>
        {t('view.dragHint')}
        {showMarkers && (
          <>
            {' · '}
            <span style={{ color: '#aab2bd' }}>●</span> {t('schematic.cg')} ·{' '}
            <span style={{ color: '#e34948' }}>●</span> {t('schematic.cp')}
          </>
        )}
      </p>
    </div>
  );
}
