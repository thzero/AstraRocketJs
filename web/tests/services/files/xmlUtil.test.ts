import { describe, it, expect } from 'vitest';
import { escapeXml } from '../../../src/services/files/xmlUtil';

describe('escapeXml', () => {
  it('escapes &, <, > and the double quote', () => {
    expect(escapeXml('a & b < c > d "e"')).toBe('a &amp; b &lt; c &gt; d &quot;e&quot;');
  });

  it('escapes & first so entities are not double-escaped', () => {
    expect(escapeXml('<')).toBe('&lt;');
    expect(escapeXml('&lt;')).toBe('&amp;lt;'); // the literal text "&lt;" → ampersand escaped once
  });

  it('leaves ordinary text and empty strings untouched', () => {
    expect(escapeXml('')).toBe('');
    expect(escapeXml('Estes C6')).toBe('Estes C6');
  });

  it('drops the C0 controls XML 1.0 forbids and keeps tab, line feed and carriage return', () => {
    const VT = String.fromCharCode(0x0b);
    const NUL = String.fromCharCode(0);
    const ESC = String.fromCharCode(0x1b);
    expect(escapeXml(`line${VT}break`)).toBe('linebreak');
    expect(escapeXml(`a${NUL}b${ESC}c`)).toBe('abc');
    expect(escapeXml('a\tb\nc\rd')).toBe('a\tb\nc\rd');
  });

  it('drops U+FFFE, U+FFFF and lone surrogates, which XML 1.0 also forbids', () => {
    expect(escapeXml('a￾b￿c')).toBe('abc');
    // A high half with no low half after it, and a low half on its own.
    expect(escapeXml('a\uD83Db')).toBe('ab');
    expect(escapeXml('a\uDE80b')).toBe('ab');
    expect(escapeXml('end\uD83D')).toBe('end');
  });

  it('keeps a surrogate pair, one character outside the BMP', () => {
    expect(escapeXml('rocket 🚀')).toBe('rocket \u{1F680}');
    expect(escapeXml('x￿🚀\uDE80')).toBe('x\u{1F680}');
  });
});
