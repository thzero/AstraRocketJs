import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import * as THREE from 'three';
import { Line } from '@react-three/drei';
import type { StaticInfo } from '../../engine/openRocketEngine';
import { useUnits } from '../../prefs/useUnits';
import { CalloutLabel } from './rocketCallouts';
import { marginText } from './schematicGeometry';
import { CP_INK, MARGIN_COLOR } from './stabilityGadget';

/**
 * Owns the CP row of the 3D view: marker, dashed leader and the
 * "CP · X cm  N cal · P%" label that Rocket3D mounts beside the hull. The
 * tiers and inks come from stabilityGadget.ts, so this and the floating
 * gadget never disagree on a color.
 */

/**
 * The CP station with its stability readout: quartered-circle marker on the
 * axis, dashed leader down past the hull, and the margin text at the leader's
 * end. Rendered only when `info.cp` is finite (the caller checks).
 */
export function StabilityCallout({
  info,
  maxR,
  markerR,
  tex,
}: {
  info: StaticInfo;
  maxR: number;
  markerR: number;
  tex: THREE.Texture;
}) {
  const { t } = useTranslation();
  const u = useUnits();
  const cal = info.stabilityCalibers;
  // The CP row as ONE text label (proven labelTexture/CalloutLabel path), laid
  // out left→right like the 2D: "CP · X cm   ⚠ N cal · P% — word". The tiers
  // and inks are the shared marginText / MARGIN_COLOR, the same text the 2D
  // overlay prints and the inks the callout gadget (stabilityGadget.ts) uses.
  const cpCallout = useMemo(() => {
    if (!Number.isFinite(info.cp)) return null;
    // The engine's own percentage, not ours: see StaticInfo.stabilityPercent.
    const margin = marginText(cal, info.stabilityPercent, t);
    if (!margin) return null;
    return {
      text: `${t('schematic.cp')} · ${u.fmtSym('length', info.cp)}    ${margin.text}`,
      color: MARGIN_COLOR[margin.state],
    };
  }, [info, cal, t, u]);
  // The CP leader's endpoints, memoized: drei's Line rebuilds its geometry on
  // every new `points` identity, and a literal here was a new array per render.
  const cpX = info.cp;
  const cpLeader = useMemo(
    () =>
      [
        [cpX, 0, 0],
        [cpX, -maxR * 1.7, 0],
      ] as [number, number, number][],
    [cpX, maxR],
  );

  return (
    <>
      <sprite position={[info.cp, 0, 0]} scale={[markerR * 0.5, markerR * 0.5, 1]} renderOrder={12}>
        <spriteMaterial map={tex} depthTest={false} transparent />
      </sprite>
      <Line
        points={cpLeader}
        color={CP_INK}
        lineWidth={1.4}
        dashed
        dashSize={maxR * 0.15}
        gapSize={maxR * 0.1}
        depthTest={false}
        transparent
        renderOrder={12}
      />
      {cpCallout && (
        <CalloutLabel
          text={cpCallout.text}
          color={cpCallout.color}
          place="right"
          position={[info.cp, -maxR * 1.7, 0]}
          height={markerR * 0.52}
          gap={markerR * 0.3}
        />
      )}
    </>
  );
}
