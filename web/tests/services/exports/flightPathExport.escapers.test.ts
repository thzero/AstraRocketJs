import { describe, it, expect } from 'vitest';
import { renderUserTemplate, type FlightPathModel } from '../../../src/services/exports/flightPathExport';

/**
 * The escaper a user template gets, chosen by its filename's extension.
 *
 * `templateStore.parseTemplateFilename` defaults a bare name to `txt`, so the
 * fall-through branch is reachable by anyone who saves a template without a
 * recognized extension. It cannot be the identity function: real values, some
 * of them file-sourced component names, would render raw into a format whose
 * quoting rules nothing here knows.
 */
describe('renderUserTemplate escapers', () => {
  const m = { title: '' } as unknown as FlightPathModel;
  const render = (ext: string, title: string) => renderUserTemplate('{{title}}', ext, { ...m, title });
  const NUL = String.fromCharCode(0);
  const DEL = String.fromCharCode(127);

  it('escapes XML-family output', () => {
    for (const ext of ['gpx', 'xml', 'html', 'htm', 'xhtml', 'svg', 'HTML']) {
      expect(render(ext, '<a & "b">'), ext).toBe('&lt;a &amp; &quot;b&quot;&gt;');
    }
  });

  it('leaves angle brackets out of KML values, which a viewer may set into HTML', () => {
    for (const ext of ['kml', 'KML']) expect(render(ext, '<a & "b">'), ext).toBe('a &amp; &quot;b&quot;');
  });

  it("escapes JSON output with JSON's own rules", () => {
    // The template supplies the surrounding quotes, as it does for csv and xml,
    // so the escaper must not add its own.
    expect(render('json', 'a"b\\c')).toBe('a\\"b\\\\c');
    expect(render('json', 'line\nbreak')).toBe('line\\nbreak');
    // Valid JSON once the template's quotes are around it.
    expect(JSON.parse(`"${render('json', 'a"b')}"`)).toBe('a"b');
  });

  it('neutralizes spreadsheet formulas in TSV output', () => {
    // A TSV opens straight into a spreadsheet, so a file-sourced name must not
    // become a live formula there.
    expect(render('tsv', '=HYPERLINK("http://x")')).toBe(`'=HYPERLINK("http://x")`);
    expect(render('TSV', '@SUM(A1)')).toBe("'@SUM(A1)");
    expect(render('tsv', '-80.6')).toBe('-80.6');
    // TSV has no quoting, so a tab or line break cannot stay in a value, and the
    // trigger behind it is neutralized before it becomes a space.
    expect(render('tsv', 'a\t=1+1')).toBe("a '=1+1");
    expect(render('tsv', 'row\n+forged')).toBe("row '+forged");
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
