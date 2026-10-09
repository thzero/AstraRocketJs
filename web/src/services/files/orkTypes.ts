import type { FlightSummary } from '../../engine/openRocketEngine';
import type { OrkSimulation } from './ork/importSimulations';
import { type MotorSpec, type RocketTree } from '../../engine/openRocketEngine';
import { type LaunchConditions } from '../design/orkTree';
import type { EmbeddedMotorFile } from './ork/embeddedMotors';

export interface OrkMotorRef {
  designation: string;
  manufacturer: string;
  /** The file's own `<digest>`, carried through so a re-export still names the
   *  desktop database entry the file named. */
  digest?: string;
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
  /** Every mount's motor, keyed by the mount's editor node id. */
  motors: Record<string, OrkMotorRef>;
  ignored: string[];
  notes: string[];
  /**
   * Launch conditions from the file's first <simulation>'s <conditions>:
   * only the fields the file actually carried (temperature/pressure are set
   * to null when the file declares the ISA standard atmosphere).
   */
  launch?: Partial<LaunchConditions>;
  /** Every <simulation> a .ork carried, with its result summary (ork/importSimulations). */
  simulations?: OrkSimulation[];
  /**
   * RockSim thrust curves the `.ork` archive carried, as raw `.rse` text.
   *
   * OpenRocket embeds the curve of every motor a design uses so the file opens
   * on an install that does not have them. `loadOrk` falls back to these when
   * the catalog cannot resolve a motor by name, instead of leaving the mount
   * empty. Absent for a bare-XML `.ork` and for a `.rkt`, neither of which can
   * carry one.
   */
  embeddedMotors?: string[];
}

/** One rocket-level <motorconfiguration> declaration. */
export interface OrkFlightConfig {
  id: string;
  /** Desktop writes <name> only when the user renamed the configuration. */
  name: string | null;
  isDefault: boolean;
  /**
   * This configuration's per-mount motors, keyed by the
   * mount's editor node id from the same parse, resolved with the same
   * default/override semantics as the chosen config. A mount with no motor
   * for this configuration simply has no entry.
   */
  motors: Record<string, OrkMotorRef>;
  /**
   * This configuration's <deploymentconfiguration> overrides, keyed by the
   * recovery device's editor node id. Carried so a save can write every
   * configuration's recovery settings back; without it, the configuration the
   * user opened would become the file's default for all of them, which could
   * leave another configuration's chute set to deploy at the wrong time.
   */
  deployments: Record<string, OrkDeployOverride>;
  /**
   * This configuration's <separationconfiguration> overrides, keyed by the
   * booster's editor node id. Carried for the same reason the deployments are:
   * a save that wrote one configuration's staging over every other one would
   * change when a booster lets go on flights nobody opened.
   */
  separations: Record<string, OrkSepOverride>;
  /**
   * This configuration's grounded stages, by the stage's editor node id: the
   * `<stage number="n" active="false"/>` flags in its declaration.
   */
  grounded: string[];
}

/** One <deploymentconfiguration> block's fields (all optional, as in the file). */
export interface OrkDeployOverride {
  deployEvent?: string;
  deployAltitude?: number;
  deployDelay?: number;
}

/** One <separationconfiguration> block's fields (all optional, as in the file). */
export interface OrkSepOverride {
  separationEvent?: string;
  separationDelay?: number;
  separationAltitude?: number;
}

/**
 * What importOrk and importRkt return: OrkTreeImportResult plus the
 * flight-configuration table.
 */
export interface OrkImportResult extends OrkTreeImportResult {
  /** Declared flight configurations in file order (empty when none). */
  configs: OrkFlightConfig[];
  /**
   * The configuration whose motors/ignition/deployment/separation were
   * applied: the default="true" one, else the first declared; null when the
   * file declares none (per-component reads then take the first element).
   */
  chosenConfigId: string | null;
}

export interface OrkExportMotor {
  designation: string;
  manufacturer?: string;
  /**
   * OpenRocket's own digest for the motor: which of its database entries this
   * is. Several can share a manufacturer and designation, and with no digest
   * the desktop takes the first and says it did.
   */
  digest?: string;
  diameter: number;
  length: number;
  delay: number;
  /** Kernel ignition-event name (automatic|launch|ejectioncharge|burnout|never). */
  ignitionEvent?: string;
  ignitionDelay?: number;
  /**
   * The curve of a motor our catalog does not have, written into the `.ork` zip
   * under its digest so the file opens with it anywhere.
   */
  embedded?: EmbeddedMotorFile;
  /** The seated motor, for a save to embed its curve when the catalog has no row for it. Not written itself. */
  seated?: MotorSpec;
}

// ---- Optional <designinfo> block (derived statistics + fin-root positions) ----
// Written only when the "save design info" preference is on. Purely informational:
// OpenRocket recomputes it live and skips this on load; other software ignores it.

/** One derived statistic: a label, a pre-formatted value (4 significant figures,
 *  no exponent), and its unit token (m | kg | kg*m^2 | cal | % | 1/rad | ''). */
export interface DesignStat {
  field: string;
  value: string;
  unit: string;
}

/** A statistics group: the whole rocket, or one stage of a multi-stage design. */
export interface DesignStatGroup {
  scope: 'rocket' | 'stage';
  stageNumber?: number;
  name?: string;
  stats: DesignStat[];
}

/** A fin set's nose-tip → fin-root distances (m). */
export interface DesignFinSet {
  stageNumber: number;
  stage: string;
  name: string;
  /** Nose tip → fore (top) of the fin root. */
  topX: number;
  /** Nose tip → aft (bottom) of the fin root. */
  bottomX: number;
}

export interface DesignInfo {
  groups: DesignStatGroup[];
  finsets: DesignFinSet[];
}

/** One flight configuration to write, with its stable id from import. */
export interface OrkExportConfig {
  id: string;
  /** Written as <name> only when non-null (desktop writes renamed configs only). */
  name: string | null;
  /** This configuration's motors keyed by mount node id. */
  motors: Record<string, OrkExportMotor>;
  /**
   * This configuration's recovery-deployment overrides keyed by recovery-device
   * node id, as captured at import. A configuration without them takes the live
   * tree's values instead; these keep every other configuration intact.
   */
  deployments?: Record<string, OrkDeployOverride>;
  /**
   * This configuration's separation overrides keyed by booster node id, the way
   * `deployments` carries its recovery.
   */
  separations?: Record<string, OrkSepOverride>;
  /** The stages this configuration leaves on the ground, by node id. */
  grounded?: string[];
}

/** One simulation as the .ork writer takes it. */
export interface OrkExportSimulation {
  name: string;
  /** The configuration it flies; must be one of `configs`, else the default is used. */
  configId: string;
  launch: LaunchConditions;
  /** The result summary to write as <flightdata>, when it has one. */
  summary?: FlightSummary;
  /**
   * The status the desktop reads: `uptodate` and `outdated` with a summary,
   * `notsimulated` without. The desktop loads any summary as loaded unless the
   * status says outdated (SingleSimulationHandler).
   */
  status: 'uptodate' | 'outdated' | 'notsimulated';
  /** Simulation children carried from the file this design was opened from (desktop extensions and the like). */
  xmlExtra?: string[];
}

export interface OrkTreeExportInput {
  name: string;
  tree: RocketTree;
  /**
   * The design's flight configurations, each carrying its own motors. Every one
   * is written, with its stable id, so a file that came in with three comes back
   * out with three. Absent or empty for a design that has no configurations at
   * all, where one is minted (see `resolveWriteConfigs`).
   */
  configs?: OrkExportConfig[];
  /** Which configuration is written default="true"; the first when unset. */
  activeConfigId?: string | null;
  /** Launch-site conditions, written as one <simulation> when present and `simulations` is not. */
  launch?: LaunchConditions;
  /**
   * Every simulation, each written as its own <simulation> with its name, the
   * configuration it flies, its conditions and, when it has one, the summary of
   * its result. Takes precedence over `launch`.
   */
  simulations?: OrkExportSimulation[];
  /** Derived statistics block; emitted only when the caller opts in (preference). */
  designInfo?: DesignInfo;
}
