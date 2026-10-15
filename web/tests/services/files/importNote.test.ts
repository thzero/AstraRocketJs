// @vitest-environment jsdom
// cspell:ignore Botón
import { describe, it, expect } from 'vitest';
import { importNoteText, keyedNote, type ImportNote } from '../../../src/services/files/importNote';
import { noteText, noteTexts } from '../../testing/importNotes';
import { noteList, notePartName } from '../../../src/services/files/importNote';
import { exportOrk, importOrk } from '../../../src/services/files/orkFile';
import { lineInstances } from '../../../src/tree/placement';
import { walkNodes } from '../../../src/tree/treeWalk';
import { specToTree, type RocketSpec } from '../../testing/specTree';
import i18n from '../../../src/i18n';
import es from '../../../src/i18n/locales/es.json';
import type { ComponentNode } from '../../../src/engine/openRocketEngine';

describe('importNoteText', () => {
  it('returns a plain string as stored', () => {
    expect(noteText('Saved as English text.')).toBe('Saved as English text.');
  });

  it('translates a keyed note with its values', () => {
    expect(noteText(keyedNote('importNote.skippedUnsupported', { name: 'RingTail' }))).toBe(
      'Skipped unsupported: RingTail',
    );
  });

  it('renders a damaged stored note as empty rather than as a raw object', () => {
    const t = (key: string) => key;
    expect(importNoteText(null as unknown as ImportNote, t)).toBe('');
    expect(importNoteText({ values: {} } as unknown as ImportNote, t)).toBe('');
  });
});

/**
 * A note is made when the file is opened and read whenever the banner shows
 * it, in whatever language the app is in by then. So a part's type name, a
 * translated extension name and the join of a list are all done when it is
 * read; made at import, they would stay in the language the file was opened in.
 */
describe('a keyed note read in another language', () => {
  const inSpanish = async (read: () => string): Promise<string> => {
    await i18n.changeLanguage('es');
    try {
      return read();
    } finally {
      await i18n.changeLanguage('en');
    }
  };
  const esList = (items: string[]) => new Intl.ListFormat('es', { type: 'conjunction' }).format(items);

  it("names an unnamed part by its type in the reader's language", async () => {
    const note = keyedNote('importNote.mountsWithoutMotor', {
      mounts: noteList([notePartName({ type: 'innertube' }), notePartName({ type: 'bodytube', name: 'Botón' })], {
        quote: true,
      }),
    });
    expect(await inSpanish(() => importNoteText(note, i18n.t))).toBe(
      es.importNote.mountsWithoutMotor.replace('{{mounts}}', esList([`"${es.part.innertube}"`, '"Botón"'])),
    );
  });

  it('joins a list cut short with an ellipsis', async () => {
    const note = keyedNote('importNote.notRead', { items: noteList(['a', 'b'], { more: true }) });
    expect(await inSpanish(() => importNoteText(note, i18n.t))).toBe(
      es.importNote.notRead.replace('{{items}}', `${esList(['a', 'b'])} …`),
    );
  });
});

/**
 * Repeated parts raise no note: the side and 3D views draw every copy a part's
 * instance count makes (`lineInstances`, which both views map over), so there is
 * nothing the drawing leaves out to warn about.
 */
describe('a file with repeated parts', () => {
  it('opens with no note about the copies, and every copy is drawn', () => {
    const { tree } = specToTree({
      noseCone: { length: 0.1, aftRadius: 0.013, thickness: 0.001 },
      bodyTube: { length: 0.3, outerRadius: 0.013, thickness: 0.0005 },
      fins: { count: 3, rootChord: 0.06, tipChord: 0.03, sweep: 0.03, height: 0.04, thickness: 0.003 },
      motorMount: { length: 0.07, outerRadius: 0.0092, thickness: 0.0004 },
    } as unknown as RocketSpec);
    const body = [...walkNodes(tree.components)].find((n) => n.type === 'bodytube')!;
    body.children = [
      ...(body.children ?? []),
      { type: 'launchlug', id: 'lug', instanceCount: 3 } as ComponentNode,
      { type: 'centeringring', id: 'rings', instanceCount: 2 } as ComponentNode,
    ];
    const res = importOrk(exportOrk({ name: 'Copies', tree }));
    const lug = [...walkNodes(res.tree.components)].find((n) => n.type === 'launchlug')!;
    expect(lug['instanceCount']).toBe(3);
    expect(lineInstances(lug)).toHaveLength(3);
    expect(res.notes.map((n) => (typeof n === 'string' ? n : n.key))).not.toContain('importNote.instanced');
    expect(noteTexts(res.notes).join(' ')).not.toMatch(/instances/i);
  });
});
