import { type RocketTree } from '../engine/openRocketEngine';
import { type LaunchConditions } from './orkTree';

export interface OrkMotorRef {
  designation: string;
  manufacturer: string;
  diameter: number;
  length: number;
  delay: number;
  /** Editor node id of the mount it was attached to. */
  mountId?: string;
  /** Kernel ignition-event name (automatic|launch|ejectioncharge|burnout|never). */
  ignitionEvent?: string;
  ignitionDelay?: number;
}

export interface OrkTreeImportResult {
  name: string;
  tree: RocketTree;
  /** First motor found (legacy callers). */
  motor?: OrkMotorRef;
  /** EVERY mount's motor, keyed by the mount's editor node id. */
  motors: Record<string, OrkMotorRef>;
  ignored: string[];
  notes: string[];
  /**
   * Launch conditions from the file's FIRST <simulation>'s <conditions> —
   * only the fields the file actually carried (temperature/pressure are set
   * to null when the file declares the ISA standard atmosphere).
   */
  launch?: Partial<LaunchConditions>;
}

/** One rocket-level <motorconfiguration> declaration. */
export interface OrkFlightConfig {
  id: string;
  /** Desktop writes <name> only when the user renamed the configuration. */
  name: string | null;
  isDefault: boolean;
  /**
   * THIS configuration's per-mount motors (Stage B presets), keyed by the
   * mount's editor node id from the same parse, resolved with the same
   * default/override semantics as the chosen config. A mount with no motor
   * for this configuration simply has no entry.
   */
  motors: Record<string, OrkMotorRef>;
  /**
   * THIS configuration's <deploymentconfiguration> overrides, keyed by the
   * recovery device's editor node id. Carried so a save can write every
   * configuration's recovery settings back — without it, the configuration the
   * user opened became the file's new default for ALL of them, which could
   * leave another configuration's chute set to deploy at the wrong time.
   */
  deployments: Record<string, OrkDeployOverride>;
}

/** One <deploymentconfiguration> block's fields (all optional, as in the file). */
export interface OrkDeployOverride {
  deployEvent?: string;
  deployAltitude?: number;
  deployDelay?: number;
}

/**
 * importOrk's result: OrkTreeImportResult (the shape importRkt/importCdx1
 * also produce) plus the .ork flight-configuration table, so a caller can
 * offer a picker and re-import with `{ configId }`.
 */
export interface OrkImportResult extends OrkTreeImportResult {
  /** Declared flight configurations in file order (empty when none). */
  configs: OrkFlightConfig[];
  /**
   * The configuration whose motors/ignition/deployment/separation were
   * applied — opts.configId when it names a declared config, else the
   * default="true" one, else the first declared; null when the file
   * declares none (legacy first-element reads).
   */
  chosenConfigId: string | null;
}

export interface OrkExportMotor {
  designation: string;
  manufacturer?: string;
  diameter: number;
  length: number;
  delay: number;
  /** Kernel ignition-event name (automatic|launch|ejectioncharge|burnout|never). */
  ignitionEvent?: string;
  ignitionDelay?: number;
}

/** One flight configuration to write (Stage B) — the stable id from import. */
export interface OrkExportConfig {
  id: string;
  /** Written as <name> only when non-null (desktop writes renamed configs only). */
  name: string | null;
  isDefault: boolean;
  /** This configuration's motors keyed by mount node id. */
  motors: Record<string, OrkExportMotor>;
  /**
   * This configuration's recovery-deployment overrides keyed by recovery-device
   * node id, as captured at import. The ACTIVE configuration's values come from
   * the live tree instead; these keep every OTHER configuration intact.
   */
  deployments?: Record<string, OrkDeployOverride>;
}

export interface OrkTreeExportInput {
  name: string;
  tree: RocketTree;
  /** Motors keyed by mount node id (Release C: one per mount). */
  motors?: Record<string, OrkExportMotor>;
  /** Legacy single-motor form (tests/back-compat). */
  motor?: OrkExportMotor;
  mountId?: string | null;
  /** Launch-site conditions — written as one <simulation> when present. */
  launch?: LaunchConditions;
  /**
   * Stage B multi-config save. Absent/empty keeps the classic single
   * minted-config output. When supplied, every configuration is written with
   * its stable id; the ACTIVE one's motors come from `motors` (the live
   * working set — in-app edits persist into it), the rest from their own map.
   */
  configs?: OrkExportConfig[];
  /** Which config the working set (`motors`) came from; null = none/custom. */
  activeConfigId?: string | null;
}
