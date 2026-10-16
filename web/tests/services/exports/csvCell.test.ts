import { describe, it, expect } from 'vitest';
import { csvField, csvQuoted, neutralizeFormula } from '../../../src/services/exports/csvCell';

describe('neutralizeFormula', () => {
  it('prefixes every leading trigger', () => {
    for (const s of ['=1+1', '+1', '-1+HYPERLINK("x")', '-.5+cmd|x', '@SUM(A1)', '\rx', '- 1', '-']) {
      expect(neutralizeFormula(s), JSON.stringify(s)).toBe(`'${s}`);
    }
    expect(neutralizeFormula('Nose cone')).toBe('Nose cone');
  });

  it('neutralizes a leading tab and the trigger that follows it', () => {
    // The tab is itself a separator, so what comes after it is a cell too.
    expect(neutralizeFormula('\tx')).toBe("'\tx");
    expect(neutralizeFormula('\t=x')).toBe("'\t'=x");
  });

  it('neutralizes a trigger after an embedded comma, semicolon or tab', () => {
    // Excel splits on its locale's list separator, not the file's, so each of
    // these opens a cell that no quoting protects.
    expect(neutralizeFormula('x,=HYPERLINK("e")')).toBe('x,\'=HYPERLINK("e")');
    expect(neutralizeFormula('x;=1')).toBe("x;'=1");
    expect(neutralizeFormula('x\t@SUM(A1)')).toBe("x\t'@SUM(A1)");
    expect(neutralizeFormula('x; -1+1')).toBe("x; '-1+1");
    expect(neutralizeFormula('a;+b;-c')).toBe("a;'+b;'-c");
  });

  it('leaves separators that no trigger follows alone', () => {
    expect(neutralizeFormula('Booster, lower')).toBe('Booster, lower');
    expect(neutralizeFormula('a;b\tc')).toBe('a;b\tc');
  });

  it('writes a whole number unchanged, negatives and exponents included', () => {
    for (const n of ['-80.6', '-.5', '-3', '0', '12.', '1.5e-4', '-2E+3', '-1.00e+2']) {
      expect(neutralizeFormula(n), n).toBe(n);
    }
  });

  it('neutralizes a minus that leads anything but a whole number', () => {
    expect(neutralizeFormula('-x')).toBe("'-x");
    expect(neutralizeFormula('-1+1')).toBe("'-1+1");
    expect(neutralizeFormula('-1e5+1')).toBe("'-1e5+1");
  });
});

describe('csvField', () => {
  it('quotes a field holding a quote, CR, LF, comma, semicolon or tab', () => {
    expect(csvField('Say "hi"')).toBe('"Say ""hi"""');
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('a;b')).toBe('"a;b"');
    expect(csvField('a\tb')).toBe('"a\tb"');
    expect(csvField('a\rb')).toBe('"a\rb"');
    expect(csvField('a\nb')).toBe('"a\nb"');
  });

  it("quotes a field holding the file's own separator", () => {
    expect(csvField('a b', ' ')).toBe('"a b"');
    expect(csvField('a b')).toBe('a b');
  });

  it('neutralizes, then quotes', () => {
    expect(csvField('x;=1')).toBe(`"x;'=1"`);
    expect(csvField('=1')).toBe("'=1");
    expect(csvField('-80.6')).toBe('-80.6');
  });
});

describe('neutralizeFormula after a line break', () => {
  it('neutralizes a trigger that an unquoted CR or LF would start a row with', () => {
    expect(neutralizeFormula('x\n=HYPERLINK("u")')).toBe(`x\n'=HYPERLINK("u")`);
    expect(neutralizeFormula('x\r\n @1')).toBe("x\r\n '@1");
    expect(neutralizeFormula('x\r+1')).toBe("x\r'+1");
  });
});

describe('csvQuoted', () => {
  it('always quotes and neutralizes', () => {
    expect(csvQuoted('Booster')).toBe('"Booster"');
    expect(csvQuoted('x,=1')).toBe(`"x,'=1"`);
    expect(csvQuoted('"q"')).toBe('"""q"""');
  });
});
