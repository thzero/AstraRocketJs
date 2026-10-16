import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type * as THREE from 'three';
import type { StaticInfo } from '../../engine/openRocketEngine';
import { useUnits } from '../../prefs/useUnits';
import { AxisCallout } from './rocketCallouts';
import { marginText } from '../../tree/schematicGeometry';
import { CP_INK, MARGIN_INK } from './stabilityInks';
import { useSceneColors } from './sceneColors';

/**
 * Owns the CP row of the 3D view: marker, dashed leader and the
 * "CP · X cm  N cal · P%" label that Rocket3D mounts beside the hull. The
 * inks come from stabilityInks.ts, which Rocket3D's CG marker reads too, so
 * the 3D view's stability colors have one source.
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
  const scene = useSceneColors();
  const { t } = useTranslation();
  const u = useUnits();
  const cal = info.stabilityCalibers;
  // The CP row as one text label (the labelTexture/CalloutLabel path), laid
  // out left→right like the 2D: "CP · X cm", then marginText's "⚠ N cal · P%"
  // and the stability word. The tiers and inks are the shared marginText and
  // MARGIN_INK (stabilityInks.ts), the same text the 2D overlay prints.
  const cpCallout = useMemo(() => {
    if (!Number.isFinite(info.cp)) return null;
    // The engine's own percentage, not ours: see StaticInfo.stabilityPercent.
    const margin = marginText(cal, info.stabilityPercent, t);
    if (!margin) return null;
    return {
      text: `${t('schematic.cp')} · ${u.fmtSym('length', info.cp)}    ${margin.text}`,
      color: scene[MARGIN_INK[margin.state]],
    };
  }, [info, cal, t, u, scene]);
  return (
    <AxisCallout
      x={info.cp}
      dir={-1}
      color={scene[CP_INK]}
      tex={tex}
      label={cpCallout?.text}
      labelColor={cpCallout?.color}
      place="right"
      len={maxR * 1.7}
      markerR={markerR}
      dashSize={maxR * 0.15}
      gapSize={maxR * 0.1}
    />
  );
}
