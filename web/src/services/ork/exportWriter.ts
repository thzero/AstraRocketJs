import type { OrkExportMotor, OrkDeployOverride } from '../orkTypes';

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
  /** null for the ACTIVE config: its deployment comes from the live tree. */
  deployments: Record<string, OrkDeployOverride> | null;
}

export interface OrkWriter {
  /** Append one line at the given indent depth (two spaces per level). */
  emit: (depth: number, s: string) => void;
  writeConfigs: OrkWriteConfig[];
  /** The config marked default="true" (also what <simulation> references). */
  defaultId: string;
}

export function createOrkWriter(writeConfigs: OrkWriteConfig[], defaultId: string): OrkWriter & { lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    emit: (depth, s) => lines.push('  '.repeat(depth) + s),
    writeConfigs,
    defaultId,
  };
}
