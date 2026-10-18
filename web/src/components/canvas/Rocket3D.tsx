import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Bounds } from '@react-three/drei';
import type { RocketTree, StaticInfo } from '../../engine/openRocketEngine';
import type { ExportData } from '../../services/exports/schematicExport.js';
import { mergePalette } from '../../services/design/partColors';
import { useSettings } from '../../state/SettingsProvider';
import { ImageExportMenu } from './ImageExportMenu.js';
import { useUnits } from '../../prefs/useUnits';
import type { MotorDims } from '../../tree/schematicGeometry';
import { markerRadius, type RenderMode } from './rocketPieces';
import { usePieces } from './usePieces';
import { AxisCallout, markerTexture } from './rocketCallouts';
import { StabilityCallout } from './StabilityCallout';
import { RocketModel } from './RocketModel';
import { useRocketExport, type R3fHandles } from './useRocketExport';
import { CG_INK, CP_INK } from './stabilityInks';
import { token } from '../common/colorTokens';
import { useSceneColors } from './sceneColors';
import { errorText } from '../../i18n/keyedError';
import { ViewBtn } from './ViewBtn';
import { Segmented } from '../common/Segmented';

/**
 * 3D rocket view (react-three-fiber). Geometry is generated from the
 * component tree: lathe profiles for nose cones and transitions (kernel-exact
 * shape math), annulus lathes for tubes (wall and bore, solid when filled),
 * extruded shapes for fins placed at their
 * instance angles. The external shell is slightly translucent so motor mounts
 * and loaded motors read inside, and a floating CG/CP callout hangs
 * beside the hull.
 * Rocket axis = +X (nose tip at x=0, aft increasing), matching the engine.
 *
 * This file is the composition: the geometry build (rocketPieces.ts), the
 * export framing (rocketExportCamera.ts), the export handler
 * (useRocketExport.ts), the mesh list (RocketModel.tsx) and the callouts
 * (rocketCallouts.tsx, StabilityCallout.tsx) each live in their own module.
 */

export function Rocket3D({
  tree,
  info,
  motors,
  exportData,
  selectedId,
  onSelect,
  showMarkers = true,
  onError,
  ctrlSlot,
  presetSlot,
}: {
  tree: RocketTree;
  info: StaticInfo | null;
  /** Draw the CG/CP markers and callout (default true). */
  showMarkers?: boolean;
  /** Loaded motor cases keyed by mount node id, rendered seated at the
   *  mount's aft end, showing through the translucent shell. */
  motors?: MotorDims;
  /** When set, a 📷 image export menu appears. */
  exportData?: Omit<ExportData, 'spanM'>;
  /** Two-way selection sync with the component tree / 2D schematic. */
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** Reports an image export failure to the caller's note channel. */
  onError?: (message: string) => void;
  /** Header slot, middle, for the cutaway, the view type and the image export. Inline over the canvas when absent. */
  ctrlSlot?: HTMLElement | null;
  /** Header slot, left, for the camera presets. Inline over the canvas when absent. */
  presetSlot?: HTMLElement | null;
}) {
  const { t } = useTranslation();
  const u = useUnits();
  const { settings } = useSettings();
  const palette = useMemo(() => mergePalette(settings.partColors), [settings.partColors]);
  const { pieces, totalLen, maxR } = usePieces(tree, motors, palette);
  const r3f = useRef<R3fHandles | null>(null);

  // Hi-res snapshot: the same scene rendered offscreen at
  // the export width, with the on-screen path as the fallback.
  const snapshot = useRocketExport(r3f, pieces, maxR, exportData, (e) =>
    onError?.(t('export.imageFailed', { message: errorText(e, t) })),
  );
  const center = totalLen / 2;
  const camDist = Math.max(totalLen * 1.1, maxR * 6, 0.25);
  const markerR = markerRadius(totalLen, maxR);
  const scene = useSceneColors();
  const light = scene['scene-callout-light'];
  const cgTex = useMemo(() => markerTexture(scene[CG_INK], light), [scene, light]);
  const cpTex = useMemo(() => markerTexture(scene[CP_INK], light), [scene, light]);
  useEffect(
    () => () => {
      cgTex.dispose();
      cpTex.dispose();
    },
    [cgTex, cpTex],
  );

  // View presets + recovery: a pan or deep zoom can lose the rocket, and
  // these jump the camera back to known-good stations.
  // OrbitControls re-derives its state from the camera, so setting position +
  // target + update() is the whole move.
  const controls = useRef<import('three-stdlib').OrbitControls | null>(null);
  // Mirror the 2D toggle: two persistent views (side / aft) with exactly
  // one always highlighted; Reset is a momentary re-fit of the current view and
  // is never highlighted. (No third "3/4" preset: 2D has only two views.)
  const [preset, setPreset] = useState<'side' | 'aft'>('side');
  // Cutaway (section view): remove the near half of the airframe so the mount,
  // rings, couplers and packed bays inside it are seen directly rather than
  // through a translucent shell. The plane is fixed at z = 0 with the kept half
  // behind it, which is the half the side preset looks at; it does not follow
  // the camera, so orbiting past 180 degrees puts you behind the cut and the
  // side button brings it back. Per-material (not renderer.clippingPlanes)
  // because only the airframe is cut, and `localClippingEnabled` on the Canvas
  // below is what makes per-material planes work at all.
  const [cutaway, setCutaway] = useState(false);
  // Desktop's 3D view types, less the textured Unfinished one: Figure (figure
  // colors, airframe see-through, the one desktop opens on) and Finished
  // (each part's appearance).
  const [mode, setMode] = useState<RenderMode>('figure');
  const clipPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 0, -1), 0), []);
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

  // The camera presets go where the 2D view has its own, left in the header
  // row; the rest goes in the row's middle, as the 2D view's tools do. Three
  // kinds of control, so three shapes: Side / Aft move the camera, Cutaway is
  // an on/off switch, and Figure | Finished is one choice of two.
  const presets = (
    <>
      <ViewBtn onClick={resetView} title={t('view.reset3dTitle')}>
        {t('view.reset')}
      </ViewBtn>
      <ViewBtn active={preset === 'side'} onClick={() => showView('side')} title={t('view.sideTitle')}>
        {t('view.side')}
      </ViewBtn>
      <ViewBtn active={preset === 'aft'} onClick={() => showView('aft')} title={t('view.aftTitle')}>
        {t('view.aft')}
      </ViewBtn>
    </>
  );
  const tools = (
    <>
      <ViewBtn active={cutaway} onClick={() => setCutaway((c) => !c)} title={t('view.cutawayTitle')}>
        {t('view.cutaway')}
      </ViewBtn>
      <Segmented
        size="bar"
        options={['figure', 'finished'] as const}
        value={mode}
        onChange={setMode}
        fmt={(m) => t(m === 'figure' ? 'view.figure' : 'view.finished')}
        title={(m) => t(m === 'figure' ? 'view.figureTitle' : 'view.finishedTitle')}
      />
      {exportData && (
        <ImageExportMenu
          icon="📷"
          label={t('export.image')}
          fitOption
          title={t('export.imageTitle3d')}
          onPick={snapshot}
        />
      )}
    </>
  );

  return (
    <div
      className="rocket3d-wrap"
      style={{ position: 'relative', height: '100%', minHeight: 320, display: 'flex', flexDirection: 'column' }}
    >
      {presetSlot && ctrlSlot ? (
        <>
          {createPortal(presets, presetSlot)}
          {createPortal(tools, ctrlSlot)}
        </>
      ) : (
        // Mounted on its own, with no header row to go in: one row over the canvas.
        <div style={{ position: 'absolute', top: 6, left: 6, zIndex: 2, display: 'flex', gap: 6 }}>
          {presets}
          {tools}
        </div>
      )}
      <Canvas
        // Measure the layout box, not the painted one. On a portrait phone the
        // Sketch pane is turned a quarter turn, and r3f's default measurement
        // (getBoundingClientRect) reports a rotated element's axis-aligned
        // screen box, so a 658x325 host measures as 325x658 and the camera is
        // framed at aspect 0.49 instead of 2.02, drawing the rocket four times
        // too big and clipped. offsetWidth/offsetHeight ignore transforms.
        resize={{ offsetSize: true }}
        style={{ flex: '1 1 0%', minHeight: 0 }}
        camera={{ position: [center, 0, camDist * 1.05], fov: 40 }}
        // The export's live-canvas fallback reads the drawing buffer after the
        // frame; without this flag WebGL may have discarded it and drawImage
        // returns black. The preferred offscreen path does not need it.
        // localClippingEnabled is what lets a material carry its own clipping
        // plane (the cutaway); without it three.js honors only the renderer's
        // global planes and the toggle does nothing.
        gl={{ preserveDrawingBuffer: true, localClippingEnabled: true }}
        onCreated={(state) => {
          r3f.current = { gl: state.gl, scene: state.scene, camera: state.camera, setFrameloop: state.setFrameloop };
        }}
      >
        {/* Soft studio setup: warm-neutral key, cool fill, low rim; subtle,
            no shadows or environment maps. */}
        <ambientLight intensity={0.55} />
        <directionalLight position={[1.5, 2.5, 2]} intensity={0.95} color={scene['scene-light-key']} />
        <directionalLight position={[-2, 0.5, -1]} intensity={0.45} color={scene['scene-light-fill']} />
        <directionalLight position={[-0.5, -1.5, -2.5]} intensity={0.35} />
        <Bounds fit clip observe margin={1.1}>
          <group>
            <RocketModel
              pieces={pieces}
              selectedId={selectedId}
              onSelect={onSelect}
              clip={cutaway ? clipPlane : null}
              mode={mode}
            />
            {/* CG/CP sit on the rocket axis (inside the shell), so they must
              render on TOP (depthTest off, high renderOrder) to be visible,
              exactly like the 2D markers. `transparent` puts them in the
              transparent queue after the see-through shell, or the shell
              would wash over them. */}
            {/* The axis balls are drawn at half of markerRadius (see
              AxisCallout), since full-size balls overwhelm small rockets. */}
            {showMarkers && info && Number.isFinite(info.cg) && (
              <AxisCallout
                x={info.cg}
                dir={1}
                color={scene['scene-callout']}
                tex={cgTex}
                label={`${t('schematic.cg')} · ${u.fmtSym('length', info.cg)}`}
                len={maxR * 1.7}
                markerR={markerR}
              />
            )}
            {showMarkers && info && Number.isFinite(info.cp) && (
              <StabilityCallout info={info} maxR={maxR} markerR={markerR} tex={cpTex} />
            )}
          </group>
        </Bounds>
        {/* Distance limits: an unbounded zoom could bury the
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
            <span aria-hidden="true" style={{ color: token(CG_INK) }}>
              ●
            </span>{' '}
            {t('schematic.cg')} ·{' '}
            <span aria-hidden="true" style={{ color: token(CP_INK) }}>
              ●
            </span>{' '}
            {t('schematic.cp')}
          </>
        )}
      </p>
    </div>
  );
}
