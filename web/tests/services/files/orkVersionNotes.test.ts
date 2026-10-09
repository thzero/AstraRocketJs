// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { importOrk } from '../../../src/services/files/orkFile';
import { noteTexts } from '../../testing/importNotes';

/**
 * A file in a format version desktop does not list (one saved by a newer
 * OpenRocket, say) is read anyway, with desktop's own warning, so the user knows
 * something in it may not have come through.
 */
const ork = (attrs: string) =>
  `<?xml version="1.0"?><openrocket ${attrs}><rocket><name>T</name><subcomponents><stage><name>S</name><subcomponents><bodytube><name>B</name><length>0.3</length><radius>0.012</radius><thickness>0.0005</thickness></bodytube></subcomponents></stage></subcomponents></rocket></openrocket>`;
const versionNote = (attrs: string) =>
  noteTexts(importOrk(ork(attrs)).notes).find((n) => n.startsWith('Unsupported document version'));

describe('the .ork format version', () => {
  it('says nothing for a version desktop reads', () => {
    expect(versionNote('version="1.10" creator="OpenRocket 24.12"')).toBeUndefined();
    expect(versionNote('version="1.0"')).toBeUndefined();
  });

  it('warns for a newer version, naming the program that wrote it', () => {
    expect(versionNote('version="1.12" creator="OpenRocket 25.06"')).toBe(
      "Unsupported document version 1.12 (written using 'OpenRocket 25.06'), attempting to read file anyway.",
    );
  });

  it('warns for a file with no version, as desktop does', () => {
    expect(versionNote('')).toBe('Unsupported document version, attempting to read file anyway.');
  });
});
