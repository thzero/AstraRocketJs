import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fmtGroundDistance, type FieldUnit } from '../../prefs/useUnits';
import { distanceFromPad, trackExtent, type GroundPoint } from '../../services/flight/groundTrack';
import { ellipsePolygon, type DriftEllipse } from '../../services/flight/driftEllipse';
import { LINER } from '../common/map/mapStyle';
import { PlanView } from '../common/map/PlanView';
import { useGroundLayer } from '../common/map/useTileVerdict';
import { useElementResize } from '../common/useElementResize';

/**
 * The landing estimate seen from above: the pad at the center, north up, the
 * descent's drift, where it lands, every dispersion landing as a dot and the
 * two-sigma zone around them, with range rings for scale. Imagery under it is
 * the ground track's: off until asked for, the same None / Satellite / Street
 * choice, remembered across both.
 */
export function LandingMap({
  latitudeDeg,
  longitudeDeg,
  path,
  landing,
  samples,
  ellipse,
  distanceUnit,
}: {
  latitudeDeg: number;
  longitudeDeg: number;
  path: readonly GroundPoint[];
  landing: GroundPoint;
  samples: readonly GroundPoint[];
  ellipse: DriftEllipse | null;
  /** The unit the host reads this landing's distance in, so the rings agree with it. */
  distanceUnit: FieldUnit;
}) {
  const { t } = useTranslation();
  const [size, setSize] = useState(320);
  const fitRef = useRef<HTMLDivElement>(null);
  const ground = useGroundLayer(true);

  useElementResize(fitRef, (r) => setSize(Math.max(240, Math.min(r.width, 640))));

  const zone = useMemo(() => (ellipse ? ellipsePolygon(ellipse) : []), [ellipse]);
  // The ground track's framing rule, so both plan views size a flight alike.
  const extent = useMemo(
    () => trackExtent([], [...path, ...samples, ...zone, landing]),
    [path, samples, zone, landing],
  );

  const fmtDist = (m: number) => fmtGroundDistance(distanceUnit, m);

  return (
    <div ref={fitRef} className="flex w-full justify-center">
      <PlanView
        size={size}
        extent={extent}
        site={{ lat: latitudeDeg, lon: longitudeDeg }}
        ground={ground}
        fmtDist={fmtDist}
        ariaLabel={t('landing.mapLabel', { distance: fmtDist(distanceFromPad(landing)) })}
        under={({ X, Y, poly }) => (
          <>
            {zone.length > 2 && (
              <polygon
                points={poly(zone)}
                fill="#f59e0b"
                fillOpacity={0.12}
                stroke="#f59e0b"
                strokeWidth={1.5}
                strokeDasharray="4 3"
              />
            )}
            {samples.map((p, i) => (
              <circle key={i} cx={X(p.east)} cy={Y(p.north)} r={1.6} className="fill-amber-300/70" />
            ))}
          </>
        )}
      >
        {({ X, Y, poly, mapOn }) => (
          <>
            {mapOn && <polyline points={poly(path)} fill="none" stroke={LINER} strokeWidth={3.75} />}
            <polyline points={poly(path)} fill="none" stroke="#38bdf8" strokeWidth={1.75} />
            {mapOn && (
              <circle cx={X(landing.east)} cy={Y(landing.north)} r={5} fill="none" stroke={LINER} strokeWidth={4} />
            )}
            <circle cx={X(landing.east)} cy={Y(landing.north)} r={5} fill="none" stroke="#38bdf8" strokeWidth={2} />
          </>
        )}
      </PlanView>
    </div>
  );
}
