import { xmlText as text } from './xmlUtil';
import { syncAutoRadii } from './autoRadius';
import { findStages } from './treeEdit';
import type { RocketTree } from '../engine/openRocketEngine';
import type { OrkImportResult } from './orkTypes';
import { parseOrkXml, unpackOrk } from './ork/importUnpack';
import { readFlightConfigs, readStageActiveness, type OrkImportContext } from './ork/importConfigs';
import { readStages } from './ork/importReaders';
import { KNOWN_DOCUMENT_TAGS, KNOWN_ROCKET_TAGS, readPassthrough } from './ork/passthrough';
import { readLaunchConditions } from './ork/importLaunch';
import { configNotes, modelingNotes } from './ork/importNotes';

/**
 * .ork IMPORT: unpack and parse the file, pick the flight configuration to
 * apply, read the stages through the per-tag reader table
 * (`ork/importReaders.ts`), then the launch conditions and the notes. Each
 * of those steps has its own module under `ork/`; this is the orchestrator.
 */
export function importOrk(data: ArrayBuffer | string, opts?: { configId?: string }): OrkImportResult {
  const archive = unpackOrk(data);
  const doc = parseOrkXml(archive.xml);
  const rocketEl = doc.querySelector('openrocket > rocket');
  if (!rocketEl) throw new Error('Not a .ork file (missing <rocket>)');

  const name = text(rocketEl, ':scope > name') ?? 'Imported rocket';
  // Design-level metadata (OpenRocket's Rocket configuration) — preserved so a
  // round-trip export doesn't drop the designer / comments / revision.
  const designer = text(rocketEl, ':scope > designer') ?? undefined;
  const comment = text(rocketEl, ':scope > comment') ?? undefined;
  const revision = text(rocketEl, ':scope > revision') ?? undefined;
  const designType = text(rocketEl, ':scope > designtype')?.toLowerCase() ?? undefined;
  // What the stability calibers are measured against. Read rather than carried,
  // because the writer emits a `referencetype` of its own and a hardcoded
  // `maximum` brings a design measured against a custom length back measured
  // against its widest body tube.
  // Only when it is NOT the default: `maximum` is what this app measures against
  // and what the writer emits anyway, so recording it would put the same word on
  // every tree for nothing.
  const refType = text(rocketEl, ':scope > referencetype')?.toLowerCase();
  const referenceType = refType && refType !== 'maximum' ? refType : undefined;
  const customRef = Number(text(rocketEl, ':scope > customreference'));
  const customReference = Number.isFinite(customRef) && customRef > 0 ? customRef : undefined;
  // The two levels ABOVE a component that can also carry things we do not model:
  // `<rocket>` itself, and the document around it (Photo Studio, the document
  // preferences, the custom expressions). Neither was reachable from the
  // component-level pass, so both were dropped on every save.
  const rocketExtra = readPassthrough(rocketEl, KNOWN_ROCKET_TAGS);
  const docEl = doc.querySelector('openrocket');
  const docExtra = docEl ? readPassthrough(docEl, KNOWN_DOCUMENT_TAGS) : undefined;
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

  // A file spells an automatic diameter as `auto`, which the readers turn into
  // a flag. Resolve it here rather than waiting for the first edit: everything
  // downstream of an import - the drawing, the mesh, the exports - reads a
  // plain radius, and an unresolved one would draw at a default nobody chose.
  const components = syncAutoRadii({ name, components: readStages(ctx, stages) } as RocketTree).components;
  if (components.every((s) => (s.children ?? []).length === 0)) {
    throw new Error('No supported components found in this design.');
  }
  // Stage activeness, once the tree exists: the file addresses a stage by
  // number and the configurations address it by node id.
  readStageActiveness(
    configEls,
    configs,
    findStages({ name, components } as RocketTree).map((n) => n.id as string),
  );
  const { notes, ignored } = ctx;
  if (ignored.size) {
    notes.push(`Ignored unsupported components: ${[...ignored].join(', ')}.`);
  }
  notes.push(...modelingNotes(components));
  notes.push(...configNotes(rocketEl, configs));
  notes.push(...archiveNotes(doc, archive.dropped));

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
      ...(referenceType ? { referenceType } : {}),
      ...(customReference !== undefined ? { customReference } : {}),
      ...(rocketExtra ? { xmlExtra: rocketExtra } : {}),
      ...(docExtra ? { docExtra } : {}),
    },
    motor: ctx.motor,
    motors: ctx.motors,
    configs,
    chosenConfigId,
    ignored: [...ignored],
    notes,
    ...(launch ? { launch } : {}),
    ...(archive.motorFiles.length ? { embeddedMotors: archive.motorFiles } : {}),
  };
}

/**
 * What the file carried that this app does not use, said out loud.
 *
 * Silence was the real problem: appearance settings and decals were read
 * nowhere and written nowhere, so a design that came here for one dimension
 * went back stripped of its paint with nothing on screen about it. The
 * appearance XML is preserved now (services/ork/passthrough.ts) and the note
 * says so; a decal is the one thing that genuinely cannot survive, because its
 * image is a separate member of the archive that we do not keep.
 *
 * Counted off the DOCUMENT rather than reported by the readers, so no state has
 * to be threaded through every one of them to answer the same question.
 */
function archiveNotes(doc: Document, dropped: string[]): string[] {
  const out: string[] = [];
  const appearances = doc.querySelectorAll('appearance, insideappearance').length;
  const decals = doc.querySelectorAll('decal').length;
  if (appearances) {
    out.push(
      `${appearances} part appearance setting(s) are not used here (this app draws the part color only). They are preserved, so a save keeps them.`,
    );
  }
  if (decals) {
    out.push(
      `${decals} decal(s) were removed: their images are stored separately in the file and are not kept, so the reference would point at nothing.`,
    );
  }
  if (dropped.length) {
    out.push(`Not read from the file: ${dropped.slice(0, 6).join(', ')}${dropped.length > 6 ? ', …' : ''}.`);
  }
  // Whole features rather than fields, so they are named: someone who set a
  // Photo Studio shot in the desktop should know this app does not show it and
  // is not going to eat it either.
  const docLevel = ['photostudio', 'docprefs', 'datatypes'].filter((t) => doc.querySelector(`openrocket > ${t}`));
  if (docLevel.length) {
    out.push(`This app has no editor for: ${docLevel.join(', ')}. They are preserved, so a save keeps them.`);
  }
  return out;
}
