import type { TFunction } from 'i18next';
import type { ComponentNode, RocketTree } from '../../engine/openRocketEngine';
import {
  deployOverride,
  effectiveDeployment,
  effectiveSeparation,
  type FlightConfig,
  sepOverride,
  stageFlies,
} from '../../services/flight/flightConfigs';
import { findMounts, findRecoveryDevices, findSeparators, findStages } from '../../services/design/treeEdit';
import type { FieldUnit } from '../../prefs/useUnits';
import { partName, type ConfigColumn } from './ConfigsTable';
import { motorDesignation } from '../../services/motors/motorName';
import { fmtUpTo } from '../../i18n/format';
import { NO_VALUE } from '../../i18n/noValue';

/**
 * What each sub-tab of the configurations table shows: one column per mount,
 * one per recovery device, or one per stage.
 *
 * Built here rather than in the table so the table stays a grid renderer, and so
 * the three sub-tabs read alike: each cell prints the value the flight will use
 * and marks it when it is this configuration's own rather than the design's.
 */

/**
 * A value this configuration overrides, called out against the ones it inherits:
 * by color, a mark and a word for a screen reader, so the cue is not color alone.
 */
function Overridden({ children, t }: { children: React.ReactNode; t: TFunction }) {
  return (
    <span className="text-warn-300/90" title={t('configs.overridden')}>
      {children}
      <sup aria-hidden>*</sup>
      <span className="sr-only"> {t('configs.overridden')}</span>
    </span>
  );
}

/** A delay as the cells print it, in the reader's locale and seconds symbol: "+1.5s". */
const delayText = (s: number, t: TFunction) => ` +${fmtUpTo(s, 3)}${t('units.second')}`;

// A trigger, the altitude it fires at when it reads one, and its delay.
const triggerText = (event: string, altitude: string | null, delay: number, t: TFunction) =>
  `${event}${altitude ? ` ${altitude}` : ''}${delay ? delayText(delay, t) : ''}`;

export function motorColumns(tree: RocketTree, t: TFunction): ConfigColumn[] {
  return findMounts(tree).map((mt, i) => ({
    id: mt.id as string,
    label: partName(mt, i, t),
    cell: (c: FlightConfig) => {
      const seated = c.motors[mt.id as string];
      const ign = seated?.ignitionEvent;
      if (!seated?.spec.designation) return <span className="text-ink-dim">{NO_VALUE}</span>;
      return (
        <>
          {motorDesignation(seated.spec)}
          {/* Ignition only when it is not the default: an "automatic" on every
              cell is noise, and the one cell that air-starts is the thing worth
              seeing here. */}
          {ign && ign !== 'automatic' && (
            <Overridden t={t}>
              {' '}
              {t(`ignition.${ign}`)}
              {seated.ignitionDelay ? delayText(seated.ignitionDelay, t) : ''}
            </Overridden>
          )}
        </>
      );
    },
  }));
}

export function recoveryColumns(
  tree: RocketTree,
  t: TFunction,
  alt: (device: ComponentNode) => FieldUnit,
): ConfigColumn[] {
  return findRecoveryDevices(tree).map((device, i) => ({
    id: device.id as string,
    label: partName(device, i, t),
    cell: (c: FlightConfig) => {
      const over = deployOverride(c, device.id as string);
      const { deployEvent: event, deployAltitude: altitude, deployDelay: delay } = effectiveDeployment(c, device);
      const u = alt(device);
      // The altitude is only read by the altitude trigger, so printing it beside
      // "apogee" would be printing a number the flight never uses.
      const text = triggerText(t(`deployEvent.${event}`), event === 'altitude' ? u.fmtSym(altitude) : null, delay, t);
      return over ? <Overridden t={t}>{text}</Overridden> : text;
    },
  }));
}

export function separationColumns(
  tree: RocketTree,
  t: TFunction,
  alt: (stage: ComponentNode) => FieldUnit,
): ConfigColumn[] {
  // Every stage, not only the ones that separate: a configuration decides
  // whether each stage flies at all, and the top stage has no separation to
  // speak of but can still be left on the ground.
  const separates = new Set(findSeparators(tree).map((n) => n.id as string));
  return findStages(tree).map((stage, i) => ({
    id: stage.id as string,
    label: partName(stage, i, t),
    cell: (c: FlightConfig) => {
      const id = stage.id as string;
      // Grounded is the whole cell: what a stage that is not in the flight
      // separates on is not a fact about the flight.
      if (!stageFlies(c, id)) return <Overridden t={t}>{t('configs.grounded')}</Overridden>;
      if (!separates.has(id)) return <span className="text-ink-dim">{NO_VALUE}</span>;
      const over = sepOverride(c, id);
      const {
        separationEvent: event,
        separationAltitude: altitude,
        separationDelay: delay,
      } = effectiveSeparation(c, stage);
      const u = alt(stage);
      // The altitude belongs to the two altitude triggers only, so printing it
      // beside "ejection" would be printing a number the flight never uses.
      const text = triggerText(
        t(`separationEvent.${event}`),
        event.startsWith('altitude') ? u.fmtSym(altitude) : null,
        delay,
        t,
      );
      return over ? <Overridden t={t}>{text}</Overridden> : text;
    },
  }));
}
