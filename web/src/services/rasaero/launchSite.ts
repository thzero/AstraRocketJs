import type { LaunchConditions } from '../orkTree';
import { FT, INHG, MPH, fmt, type Cdx1Writer } from './units';

/**
 * Launch site back to RASAero units (feet / °F / in-Hg / mph). Pressure 0 is
 * RASAero's own "unset"; Temperature has no unset, so ISA null becomes 59 °F.
 */
export function writeLaunchSite(w: Cdx1Writer, launch: Partial<LaunchConditions> | undefined): void {
  const { emit } = w;
  emit('<LaunchSite>');
  emit(`<Altitude>${fmt((launch?.launchAltitudeM ?? 0) * FT)}</Altitude>`);
  emit(
    `<Pressure>${launch ? (launch.pressureHPa != null ? fmt(launch.pressureHPa / INHG) : '0') : '29.92'}</Pressure>`,
  );
  emit(`<RodAngle>${fmt(launch?.launchRodAngleDeg ?? 0)}</RodAngle>`);
  emit(`<RodLength>${launch?.launchRodLengthM != null ? fmt(launch.launchRodLengthM * FT) : '10'}</RodLength>`);
  emit(`<Temperature>${launch?.temperatureC != null ? fmt((launch.temperatureC * 9) / 5 + 32) : '59'}</Temperature>`);
  emit(`<WindSpeed>${fmt((launch?.windAverage ?? 0) * MPH)}</WindSpeed>`);
  emit('</LaunchSite>');
}
