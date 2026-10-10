import { xmlText as text } from './xmlUtil';
import { syncAutoRadii } from '../design/autoRadius';
import { findStages } from '../design/treeEdit';
import type { OrkImportResult } from './orkTypes';
import { parseOrkXml, unpackOrk } from './ork/importUnpack';
import { readFlightConfigs, readStageActiveness, type OrkImportContext } from './ork/importConfigs';
import { readStages } from './ork/importReaders';
import { KNOWN_DOCUMENT_TAGS, KNOWN_ROCKET_TAGS, readPassthrough } from './ork/passthrough';
import { readLaunchConditions } from './ork/importLaunch';
import { readSimulations } from './ork/importSimulations';
import { configNotes, ignoredNotes, modelingNotes } from './ork/importNotes';
import { keyedNote, type ImportNote } from './importNote';

/**
 * .ork import: unpack and parse the file, pick the flight configuration to
 * apply, read the stages through the per-tag reader table
 * (`ork/importReaders.ts`), then the launch conditions and the notes. Each
 * of those steps has its own module under `ork/`; this is the orchestrator.
 */
export function importOrk(data: ArrayBuffer | string): OrkImportResult {
  const archive = unpackOrk(data);
  const doc = parseOrkXml(archive.xml);
  const rocketEl = doc.querySelector('openrocket > rocket');
  if (!rocketEl) throw new Error('Not a .ork file (missing <rocket>)');

  const name = text(rocketEl, ':scope > name') ?? 'Imported rocket';
  // Design-level metadata (OpenRocket's Rocket configuration), preserved so a
  // round-trip export doesn't drop the designer / comments / revision.
  const designer = text(rocketEl, ':scope > designer') ?? undefined;
  const comment = text(rocketEl, ':scope > comment') ?? undefined;
  const revision = text(rocketEl, ':scope > revision') ?? undefined;
  const designType = text(rocketEl, ':scope > designtype')?.toLowerCase() ?? undefined;
  // What the stability calibers are measured against. Read rather than carried,
  // because the writer emits a `referencetype` of its own and a hardcoded
  // `maximum` would bring a design measured against a custom length back
  // measured against its widest body tube.
  // Only when it is not the default: `maximum` is what this app measures against
  // and what the writer emits anyway, so recording it would put the same word on
  // every tree for nothing.
  const refType = text(rocketEl, ':scope > referencetype')?.toLowerCase();
  const referenceType = refType && refType !== 'maximum' ? refType : undefined;
  const customRef = Number(text(rocketEl, ':scope > customreference'));
  const customReference = Number.isFinite(customRef) && customRef > 0 ? customRef : undefined;
  // The two levels above a component that can also carry things we do not model:
  // `<rocket>` itself, and the document around it (Photo Studio, the document
  // preferences, the custom expressions). Neither is reachable from the
  // component-level pass, so each is read here or it would be dropped on save.
  const rocketExtra = readPassthrough(rocketEl, KNOWN_ROCKET_TAGS);
  const docEl = doc.querySelector('openrocket');
  const docExtra = docEl ? readPassthrough(docEl, KNOWN_DOCUMENT_TAGS) : undefined;
  const stages = Array.from(rocketEl.querySelectorAll(':scope > subcomponents > stage'));
  if (stages.length === 0) throw new Error('No stage found');

  const { configEls, configs, chosenConfigId } = readFlightConfigs(rocketEl);
  const ctx: OrkImportContext = {
    configs,
    chosenConfigId,
    notes: [],
    ignored: new Set<string>(),
    motors: {},
    motor: undefined,
    nodeCount: 0,
  };

  // A file spells an automatic diameter as `auto`, which the readers turn into
  // a flag. Resolve it here rather than waiting for the first edit: everything
  // downstream of an import (the drawing, the mesh, the exports) reads a
  // plain radius, and an unresolved one would draw at a default nobody chose.
  const components = syncAutoRadii({ name, components: readStages(ctx, stages) }).components;
  if (components.every((s) => (s.children ?? []).length === 0)) {
    throw new Error('No supported components found in this design.');
  }
  // Stage activeness, once the tree exists: the file addresses a stage by
  // number and the configurations address it by node id.
  readStageActiveness(
    configEls,
    configs,
    findStages({ name, components }).map((n) => n.id as string),
  );
  const { notes, ignored } = ctx;
  notes.push(...versionNotes(doc));
  notes.push(...ignoredNotes(ignored));
  notes.push(...modelingNotes(components));
  notes.push(...configNotes(rocketEl, configs));
  notes.push(...archiveNotes(doc, archive.dropped));

  const launch = readLaunchConditions(doc);
  const simulations = readSimulations(doc);

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
    ...(simulations.length ? { simulations } : {}),
    ...(archive.motorFiles.length ? { embeddedMotors: archive.motorFiles } : {}),
  };
}

/**
 * The `.ork` format versions desktop OpenRocket reads without a warning
 * (DocumentConfig.SUPPORTED_VERSIONS). A file outside them, such as one saved
 * by a newer OpenRocket, may carry things this reader does not know.
 */
const SUPPORTED_ORK_VERSIONS: ReadonlySet<string> = new Set([
  '1.0',
  '1.1',
  '1.2',
  '1.3',
  '1.4',
  '1.5',
  '1.6',
  '1.7',
  '1.8',
  '1.9',
  '1.10',
  '1.11',
]);

/**
 * Desktop's warning for a format version outside the supported set
 * (OpenRocketHandler), in its words: the file is still read.
 */
function versionNotes(doc: Document): ImportNote[] {
  const root = doc.querySelector('openrocket');
  const version = root?.getAttribute('version')?.trim() || null;
  if (version !== null && SUPPORTED_ORK_VERSIONS.has(version)) return [];
  const creator = root?.getAttribute('creator')?.trim();
  if (version && creator) return [keyedNote('importNote.versionUnsupportedBy', { version, creator })];
  if (version) return [keyedNote('importNote.versionUnsupported', { version })];
  if (creator) return [keyedNote('importNote.versionMissingBy', { creator })];
  return [keyedNote('importNote.versionMissing')];
}

/**
 * What the file carried that this app does not use, said out loud.
 *
 * Appearance XML is preserved (services/files/ork/passthrough.ts) and the note
 * says so; a decal is the one thing that cannot survive, because its image is a
 * separate member of the archive that we do not keep.
 *
 * Counted off the document rather than reported by the readers, so no state has
 * to be threaded through every one of them to answer the same question.
 */
function archiveNotes(doc: Document, dropped: string[]): ImportNote[] {
  const out: ImportNote[] = [];
  const appearances = doc.querySelectorAll('appearance, insideappearance').length;
  const decals = doc.querySelectorAll('decal').length;
  if (appearances) {
    out.push(keyedNote('importNote.appearances', { total: appearances }));
  }
  if (decals) {
    out.push(keyedNote('importNote.decals', { total: decals }));
  }
  const extensions = [
    ...doc.querySelectorAll(
      'openrocket > simulations > simulation > extension, openrocket > simulations > simulation > listener',
    ),
  ];
  if (extensions.length) {
    // The id's last segment is the extension's class name: AirStart, RollControl.
    const names = [
      ...new Set(
        extensions.map(
          (e) => (e.getAttribute('extensionid') ?? e.textContent ?? '').trim().split('.').pop() || 'unnamed',
        ),
      ),
    ];
    out.push(keyedNote('importNote.extensions', { names: names.join(', ') }));
  }
  if (dropped.length) {
    out.push(
      keyedNote('importNote.notRead', { items: `${dropped.slice(0, 6).join(', ')}${dropped.length > 6 ? ', …' : ''}` }),
    );
  }
  // Whole features rather than fields, so they are named: someone who set a
  // Photo Studio shot in the desktop should know this app does not show it and
  // does not discard it either.
  const docLevel = ['photostudio', 'docprefs', 'datatypes'].filter((t) => doc.querySelector(`openrocket > ${t}`));
  if (docLevel.length) {
    out.push(keyedNote('importNote.noEditor', { items: docLevel.join(', ') }));
  }
  return out;
}
