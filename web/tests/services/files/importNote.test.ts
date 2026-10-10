import { describe, it, expect } from 'vitest';
import { importNoteText, keyedNote, type ImportNote } from '../../../src/services/files/importNote';
import { noteText } from '../../testing/importNotes';

describe('importNoteText', () => {
  it('returns a plain string as stored', () => {
    expect(noteText('Saved as English text.')).toBe('Saved as English text.');
  });

  it('translates a keyed note with its values', () => {
    expect(noteText(keyedNote('importNote.ignored', { names: 'RingTail' }))).toBe(
      'Ignored unsupported components: RingTail.',
    );
  });

  it('renders a damaged stored note as empty rather than as a raw object', () => {
    const t = (key: string) => key;
    expect(importNoteText(null as unknown as ImportNote, t)).toBe('');
    expect(importNoteText({ values: {} } as unknown as ImportNote, t)).toBe('');
  });
});
