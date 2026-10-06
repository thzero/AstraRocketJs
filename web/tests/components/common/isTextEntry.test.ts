// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { isTextEntry } from '../../../src/components/common/isTextEntry';

describe('isTextEntry', () => {
  it('is true for fields, list boxes and editable content', () => {
    for (const tag of ['input', 'textarea', 'select']) expect(isTextEntry(document.createElement(tag))).toBe(true);
    const div = document.createElement('div');
    div.setAttribute('contenteditable', 'true');
    document.body.append(div);
    expect(isTextEntry(div)).toBe(true);
    div.remove();
  });

  it('is false for anything else, and for nothing', () => {
    expect(isTextEntry(document.createElement('button'))).toBe(false);
    expect(isTextEntry(null)).toBe(false);
  });
});
