import { xmlText as text } from './xmlUtil';
import type { OrkImportResult } from './orkTypes';
import { parseOrkXml, unpackOrkXml } from './ork/importUnpack';
import { readFlightConfigs, type OrkImportContext } from './ork/importConfigs';
import { readStages } from './ork/importReaders';
import { readLaunchConditions } from './ork/importLaunch';
import { configNotes, modelingNotes } from './ork/importNotes';

/**
 * .ork IMPORT: unpack and parse the file, pick the flight configuration to
 * apply, read the stages through the per-tag reader table
 * (`ork/importReaders.ts`), then the launch conditions and the notes. Each
 * of those steps has its own module under `ork/`; this is the orchestrator.
 */
export function importOrk(data: ArrayBuffer | string, opts?: { configId?: string }): OrkImportResult {
  const doc = parseOrkXml(unpackOrkXml(data));
  const rocketEl = doc.querySelector('openrocket > rocket');
  if (!rocketEl) throw new Error('Not a .ork file (missing <rocket>)');

  const name = text(rocketEl, ':scope > name') ?? 'Imported rocket';
  // Design-level metadata (OpenRocket's Rocket configuration) — preserved so a
  // round-trip export doesn't drop the designer / comments / revision.
  const designer = text(rocketEl, ':scope > designer') ?? undefined;
  const comment = text(rocketEl, ':scope > comment') ?? undefined;
  const revision = text(rocketEl, ':scope > revision') ?? undefined;
  const designType = text(rocketEl, ':scope > designtype')?.toLowerCase() ?? undefined;
  const stages = Array.from(rocketEl.querySelectorAll(':scope > subcomponents > stage'));
  if (stages.length === 0) throw new Error('No stage found');

  const { configEls, configs, chosenConfigId } = readFlightConfigs(rocketEl, opts?.configId);
  const ctx: OrkImportContext = {
    configs,
    chosenConfigId,
    notes: [],
    ignored: new Set<string>(),
    motors: {},
    motor: undefined,
  };

  const components = readStages(ctx, stages);
  if (components.every((s) => (s.children ?? []).length === 0)) {
    throw new Error('No supported components found in this design.');
  }
  const { notes, ignored } = ctx;
  if (ignored.size) {
    notes.push(`Ignored unsupported components: ${[...ignored].join(', ')}.`);
  }
  notes.push(...modelingNotes(components));
  notes.push(...configNotes(rocketEl, configEls, configs, chosenConfigId));

  const launch = readLaunchConditions(doc);

  return {
    name,
    tree: {
      name,
      components,
      ...(designer ? { designer } : {}),
      ...(comment ? { comment } : {}),
      ...(revision ? { revision } : {}),
      ...(designType ? { designType } : {}),
    },
    motor: ctx.motor,
    motors: ctx.motors,
    configs,
    chosenConfigId,
    ignored: [...ignored],
    notes,
    ...(launch ? { launch } : {}),
  };
}
