// cspell:ignore Botón
import { describe, it, expect } from 'vitest';
import { importNoteText, keyedNote, type ImportNote } from '../../../src/services/files/importNote';
import { noteText } from '../../testing/importNotes';
import { modelingNotes } from '../../../src/services/files/ork/importNotes';
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

describe('modelingNotes', () => {
  it('names an unnamed repeated part by its translated type, in a list of the UI language', async () => {
    await i18n.changeLanguage('es');
    try {
      const [note] = modelingNotes([
        {
          type: 'stage',
          children: [
            { type: 'launchlug', instanceCount: 2 },
            { type: 'railbutton', name: 'Botón', instanceCount: 2 },
          ],
        } as unknown as ComponentNode,
      ]);
      expect(note).toMatchObject({
        key: 'importNote.instanced',
        values: { names: `${es.part.launchlug} y Botón` },
      });
    } finally {
      await i18n.changeLanguage('en');
    }
  });
});
