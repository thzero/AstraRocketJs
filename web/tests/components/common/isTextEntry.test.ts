// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { isTextEntry, takesArrowKeys } from '../../../src/components/common/isTextEntry';

const input = (type: string) => {
  const el = document.createElement('input');
  el.type = type;
  return el;
};

describe('isTextEntry', () => {
  it('is true for text fields, text areas and editable content', () => {
    for (const type of ['text', 'search', 'number', 'email', 'password']) expect(isTextEntry(input(type))).toBe(true);
    expect(isTextEntry(document.createElement('input'))).toBe(true); // no type is a text field
    expect(isTextEntry(document.createElement('textarea'))).toBe(true);
    const div = document.createElement('div');
    div.setAttribute('contenteditable', 'true');
    document.body.append(div);
    expect(isTextEntry(div)).toBe(true);
    div.remove();
  });

  it('is false for controls with no typed text, and for nothing', () => {
    for (const type of ['checkbox', 'radio', 'range', 'color']) expect(isTextEntry(input(type))).toBe(false);
    expect(isTextEntry(document.createElement('select'))).toBe(false);
    expect(isTextEntry(document.createElement('button'))).toBe(false);
    expect(isTextEntry(null)).toBe(false);
  });
});

describe('takesArrowKeys', () => {
  it('is true for text entry, a list box, a radio and a range', () => {
    expect(takesArrowKeys(input('text'))).toBe(true);
    expect(takesArrowKeys(document.createElement('select'))).toBe(true);
    expect(takesArrowKeys(input('radio'))).toBe(true);
    expect(takesArrowKeys(input('range'))).toBe(true);
  });

  it('is false for a checkbox, a button and nothing', () => {
    expect(takesArrowKeys(input('checkbox'))).toBe(false);
    expect(takesArrowKeys(document.createElement('button'))).toBe(false);
    expect(takesArrowKeys(null)).toBe(false);
  });
});
