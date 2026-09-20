import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import * as THREE from 'three';
import { Line } from '@react-three/drei';
import type { StaticInfo } from '../../engine/openRocketEngine';
import { fmtNum } from '../../i18n/format';
import { stabilityState } from '../../services/simReport.js';
import { useUnits } from '../../prefs/useUnits';
import { CalloutLabel } from './rocketCallouts';
import { MARGIN_COLOR } from './stabilityGadget';

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
  // and inks are the shared stabilityState / MARGIN_COLOR, the same pair the
  // callout gadget (stabilityGadget.ts) uses, rather than a second copy of the 1..6 band.
  const cpCallout = useMemo(() => {
    if (!Number.isFinite(info.cp)) return null;
    const state = stabilityState(cal);
    if (!state || cal == null) return null;
    const pct = info.length > 0 ? fmtNum(((info.cp - info.cg) / info.length) * 100, 1) : '0';
    const word =
      state === 'under'
        ? ` — ${t('schematic.underStable')}`
        : state === 'over'
          ? ` — ${t('schematic.overStable')}`
          : '';
    const warn = state === 'ok' ? '' : '⚠️ ';
    return {
      text: `${t('schematic.cp')} · ${u.fmt('length', info.cp)} ${u.sym('length')}    ${warn}${fmtNum(cal, 2)} ${t('stability.caliber')} · ${pct}%${word}`,
      color: MARGIN_COLOR[state],
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
        color="#e34948"
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
