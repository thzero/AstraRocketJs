/**
 * The input types that take typed text. Ctrl+Z in one of these is the browser's
 * own field undo; a checkbox, radio, range, color or file input has no such
 * undo, so the page-level shortcut stays live there.
 */
const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number']);

/**
 * Whether keystrokes on this element are text entry: a text-like field, a
 * textarea or editable content. A page-level shortcut leaves them alone, so
 * Ctrl+Z undoes the typing and the arrow keys move the caret.
 */
export function isTextEntry(el: Element | null | undefined): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(el.type);
  if (el.tagName === 'TEXTAREA') return true;
  // `isContentEditable` where the browser has it; the attribute, inherited down
  // the tree, where it does not (jsdom).
  return el.isContentEditable === true || el.closest('[contenteditable]:not([contenteditable="false"])') !== null;
}

/**
 * Whether the element answers the arrow keys itself: text entry, a list box,
 * and every input except a checkbox, the button types (button, submit, reset,
 * image), file, color and hidden, none of which use the arrows (a radio steps
 * its group, a range moves its thumb, a date field steps a segment). A
 * page-level arrow-key handler leaves them alone.
 */
export function takesArrowKeys(el: Element | null | undefined): boolean {
  if (isTextEntry(el)) return true;
  if (el instanceof HTMLSelectElement) return true;
  if (!(el instanceof HTMLInputElement)) return false;
  return !['checkbox', 'button', 'submit', 'reset', 'image', 'file', 'color', 'hidden'].includes(el.type);
}
