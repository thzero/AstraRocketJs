import { describe, it, expect } from 'vitest';
import { escapeXml } from './xmlUtil';

describe('escapeXml', () => {
  it('escapes the five-ish XML metacharacters including the quote', () => {
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
});
