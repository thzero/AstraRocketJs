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

/**
 * What each sub-tab of the configurations table shows: one column per mount, or
 * one per recovery device.
 *
 * Built here rather than in the table so the table stays a grid renderer, and so
 * the two sub-tabs cannot drift apart on how a cell reads: both print the value
 * the flight will use, and both mark it when it is this configuration's own
 * rather than the design's.
 */

/** A value this configuration overrides, called out against the ones it inherits. */
function Overridden({ children }: { children: React.ReactNode }) {
  return <span className="text-warn-300/90">{children}</span>;
}

export function motorColumns(tree: RocketTree, t: TFunction): ConfigColumn[] {
  return findMounts(tree).map((mt, i) => ({
    id: mt.id as string,
    label: partName(mt, i, t),
    cell: (c: FlightConfig) => {
      const seated = c.motors[mt.id as string];
      const ign = seated?.ignitionEvent;
      if (!seated?.spec.designation) return <span className="text-ink-dim">–</span>;
      return (
        <>
          {motorDesignation(seated.spec)}
          {/* Ignition only when it is not the default: an "automatic" on every
              cell is noise, and the one cell that air-starts is the thing worth
              seeing here. */}
          {ign && ign !== 'automatic' && (
            <Overridden>
              {' '}
              {t(`ignition.${ign}`)}
              {seated.ignitionDelay ? ` +${seated.ignitionDelay}s` : ''}
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
      const text = `${t(`deployEvent.${event}`)}${event === 'altitude' ? ` ${u.fmtSym(altitude)}` : ''}${
        delay ? ` +${delay}s` : ''
      }`;
      return over ? <Overridden>{text}</Overridden> : text;
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
      if (!stageFlies(c, id)) return <Overridden>{t('configs.grounded')}</Overridden>;
      if (!separates.has(id)) return <span className="text-ink-dim">–</span>;
      const over = sepOverride(c, id);
      const {
        separationEvent: event,
        separationAltitude: altitude,
        separationDelay: delay,
      } = effectiveSeparation(c, stage);
      const u = alt(stage);
      // The altitude belongs to the two altitude triggers only, so printing it
      // beside "ejection" would be printing a number the flight never uses.
      const text = `${t(`separationEvent.${event}`)}${
        event.startsWith('altitude') ? ` ${u.fmtSym(altitude)}` : ''
      }${delay ? ` +${delay}s` : ''}`;
      return over ? <Overridden>{text}</Overridden> : text;
    },
  }));
}
