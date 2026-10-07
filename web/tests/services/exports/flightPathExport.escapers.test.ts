import { describe, it, expect } from 'vitest';
import { renderUserTemplate, type FlightPathModel } from '../../../src/services/exports/flightPathExport';

/**
 * The escaper a user template gets, chosen by its filename's extension.
 *
 * `templateStore.parseTemplateFilename` defaults a bare name to `txt`, so the
 * fall-through branch is reachable by anyone who saves a template without a
 * recognized extension. It used to be the identity function: real values, some
 * of them file-sourced component names, rendered raw into a format whose
 * quoting rules nothing here knows.
 */
describe('renderUserTemplate escapers', () => {
  const m = { title: '' } as unknown as FlightPathModel;
  const render = (ext: string, title: string) => renderUserTemplate('{{title}}', ext, { ...m, title });
  const NUL = String.fromCharCode(0);
  const DEL = String.fromCharCode(127);

  it('escapes XML-family output', () => {
    for (const ext of ['kml', 'gpx', 'xml']) {
      expect(render(ext, '<a & "b">'), ext).toBe('&lt;a &amp; &quot;b&quot;&gt;');
    }
  });

  it("escapes JSON output with JSON's own rules", () => {
    // The template supplies the surrounding quotes, as it does for csv and xml,
    // so the escaper must not add its own.
    expect(render('json', 'a"b\\c')).toBe('a\\"b\\\\c');
    expect(render('json', 'line\nbreak')).toBe('line\\nbreak');
    // Valid JSON once the template's quotes are around it.
    expect(JSON.parse(`"${render('json', 'a"b')}"`)).toBe('a"b');
  });

  it('strips control characters for an unknown extension', () => {
    // It cannot know the format's quoting rules, but a C0 control is what a
    // crafted name would use to forge a record boundary in any text format.
    expect(render('txt', `a${NUL}b`)).toBe('a b');
    expect(render('txt', 'row\r\nforged')).toBe('row  forged');
    expect(render('txt', `del${DEL}here`)).toBe('del here');
  });

  it('leaves printable punctuation alone for an unknown extension', () => {
    // In an unknown format a quote or an angle bracket is as likely to be
    // literal content as syntax, so it is not touched.
    expect(render('txt', 'Rocket "Mk <2>" & co')).toBe('Rocket "Mk <2>" & co');
  });
});
