import type { OrkExportMotor, OrkDeployOverride, OrkSepOverride } from '../orkTypes';
import type { ComponentFigures } from '../rktExport';

/**
 * The line sink every .ork writer function draws on, plus the flight
 * configuration table the motor, deployment and separation blocks key their
 * per-config elements by. Built once by `exportOrk` and threaded through every
 * writer, so a per-type writer is a plain function and not a closure over the
 * exporter's locals.
 */

/** One flight configuration to write, resolved from the export input. */
export interface OrkWriteConfig {
  id: string;
  name: string | null;
  motors: Record<string, OrkExportMotor>;
  /** null when this configuration recovers the way the design does. */
  deployments: Record<string, OrkDeployOverride> | null;
  /** null when this configuration stages the way the design does. */
  separations: Record<string, OrkSepOverride> | null;
  /** Stage node ids this configuration leaves on the ground. */
  grounded: string[];
}

export interface OrkWriter {
  /** Append one line at the given indent depth (two spaces per level). */
  emit: (depth: number, s: string) => void;
  writeConfigs: OrkWriteConfig[];
  /** The config marked default="true" (also what <simulation> references). */
  defaultId: string;
  /** The kernel's figures for a part, by node id, where the caller has a build. */
  componentInfo?: ComponentFigures;
}

export function createOrkWriter(
  writeConfigs: OrkWriteConfig[],
  defaultId: string,
  componentInfo?: ComponentFigures,
): OrkWriter & { lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    emit: (depth, s) => lines.push('  '.repeat(depth) + s),
    writeConfigs,
    defaultId,
    componentInfo,
  };
}
