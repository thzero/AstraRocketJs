import type { ComponentNode } from '../../engine/openRocketEngine';

/**
 * Per-stage engine strings: which manufacturers RASAero's own motor database
 * documents, and the 'DESIGNATION  (ABBREV)' string each stage's first mounted
 * motor becomes.
 */

/**
 * Engine-string export gate — PROVEN against real RASAero II 2026-08-25. RASAero
 * looks every exported engine name up in its own motor database and throws a
 * NullReferenceException when the name is missing, so we only write manufacturers
 * it documents (unmapped ones are omitted entirely, never guessed).
 */
export const CDX1_ENGINE_EXPORT = true;

/**
 * Our manufacturer names → RASAero's engine-file abbreviations, from the
 * desktop's RASAeroCommonConstants.OPENROCKET_TO_RASAERO_MANUFACTURER. Keys are
 * matched normalized: uppercase, periods/commas stripped, whitespace collapsed.
 */
const RASAERO_MFG: Array<[abbrev: string, names: string[]]> = [
  ['AT', ['AEROTECH', 'AT', 'ISP']],
  ['ES', ['ESTES', 'ESTES INDUSTRIES', 'ES', 'E']],
  ['AP', ['APOGEE', 'APOGEE COMPONENTS', 'AP']],
  ['QU', ['QUEST', 'QUEST AEROSPACE', 'QU', 'Q']],
  [
    'CTI',
    [
      'CESARONI',
      'CESARONI TECHNOLOGY',
      'CESARONI TECHNOLOGY INC',
      'CESARONI TECHNOLOGY INCORPORATED',
      'CTI',
      'CES',
      'PRO38',
    ],
  ],
  ['EM', ['ELLIS', 'ELLIS MOUNTAIN', 'EM']],
  ['Contrail', ['CONTRAIL', 'CONTRAIL ROCKETS', 'CONTRAIL ROCKET', 'CR']],
  ['RV', ['ROCKETVISION', 'ROCKETVISION FLIGHT-STAR', 'ROCKET VISION', 'RV']],
  ['RR', ['ROADRUNNER', 'ROADRUNNER ROCKETRY', 'RR']],
  ['SRS', ['SKYR', 'SKY RIPPER', 'SKYRIPPER', 'SKY RIPPER SYSTEMS', 'SRS']],
  ['LR', ['LOKI', 'LOKI RESEARCH', 'LR']],
  ['PML', ['PML', 'PUBLIC MISSILES', 'PUBLIC MISSILES LTD', 'PUBLIC MISSILES LIMITED']],
  ['KBA', ['KBA', 'KOSDON BY AEROTECH', 'KOSDON/AT', 'KOSDON/AEROTECH', 'K-AT']],
  ['GM', ['GORILLA', 'GORILLA ROCKET MOTORS', 'GORILLA MOTORS', 'GM']],
  ['RTW', ['RATT', 'RATT WORKS', 'RTW', 'RT']],
  ['HT', ['HYPERTEK', 'HT']],
  ['AMW', ['AMW', 'ANIMAL MOTOR WORKS', 'ANIMAL', 'AMW PROX', 'AMW/PROX']],
];
const RASAERO_MFG_LOOKUP: Record<string, string> = Object.fromEntries(
  RASAERO_MFG.flatMap(([abbrev, names]) => names.map((n) => [n, abbrev])),
);

/**
 * The RASAero abbreviation for one of our manufacturer strings, or null when
 * RASAero doesn't document the maker — writing a name RASAero's database lacks
 * is the NRE, so unknown means OMIT, never guess.
 */
function rasaeroManufacturerAbbrev(mfg: string | undefined): string | null {
  if (!mfg) return null;
  const n = mfg.trim().toUpperCase().replace(/[.,]/g, '').replace(/\s+/g, ' ');
  if (n.startsWith('AEROTECH') || n.startsWith('AT-') || n.startsWith('RCS-')) return 'AT';
  return RASAERO_MFG_LOOKUP[n] ?? null;
}

/** The slice of a motor assignment the engine-string writer reads — the .ork
    export map (OrkExportMotor) satisfies it verbatim, extra fields ignored. */
export interface Cdx1ExportEngine {
  designation: string;
  manufacturer?: string;
  /** Kernel ignition-event name; only 'burnout' has a delay RASAero can hold. */
  ignitionEvent?: string;
  /** Seconds after the stage below's burnout (RASAero's own semantics). */
  ignitionDelay?: number;
}

export interface StageEngineSlot {
  /** 'DESIGNATION  (ABBREV)', or null: no motor, or an undocumented maker. */
  engine: string | null;
  ignitionDelay: number;
}

/**
 * Per-stage engine strings, desktop format 'DESIGNATION  (ABBREV)' — two
 * spaces, the exact shape the importer's parseEngine reads back. null = no
 * motor on the stage, or a manufacturer RASAero doesn't document (the NRE risk).
 */
export function stageEngineSlots(
  stagesIn: ComponentNode[],
  motors: Record<string, Cdx1ExportEngine> | undefined,
  engineOn: boolean,
): StageEngineSlot[] {
  return stagesIn.map((st): StageEngineSlot => {
    if (!engineOn || !motors) return { engine: null, ignitionDelay: 0 };
    let found: Cdx1ExportEngine | undefined;
    const seek = (nodes: ComponentNode[]) => {
      for (const n of nodes) {
        if (found) return;
        if (n.id && motors[n.id]) {
          found = motors[n.id];
          return;
        }
        seek(n.children ?? []);
      }
    };
    seek(st.children ?? []); // one engine per stage in RASAero — first mount wins
    // Only a burnout-triggered motor has a delay this format can express.
    const ignitionDelay = found?.ignitionEvent === 'burnout' ? (found.ignitionDelay ?? 0) : 0;
    const abbrev = found ? rasaeroManufacturerAbbrev(found.manufacturer) : null;
    return {
      engine: found && abbrev ? `${found.designation}  (${abbrev})` : null,
      ignitionDelay,
    };
  });
}
