// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { xmlText } from './xmlUtil';

const parse = (xml: string): Element => new DOMParser().parseFromString(xml, 'text/xml').documentElement;

describe('xmlText', () => {
  it('returns the trimmed text of the first matching element', () => {
    const el = parse('<root><name>  Big Bertha  </name></root>');
    expect(xmlText(el, 'name')).toBe('Big Bertha');
  });

  it('returns null for an empty or whitespace-only element', () => {
    const el = parse('<root><name>   </name><empty></empty></root>');
    expect(xmlText(el, 'name')).toBeNull();
    expect(xmlText(el, 'empty')).toBeNull();
  });

  it('returns null when the selector matches nothing', () => {
    expect(xmlText(parse('<root/>'), 'missing')).toBeNull();
  });
});
