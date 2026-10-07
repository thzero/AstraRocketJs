/**
 * Whether keystrokes on this element are text entry: a field, a list box or
 * editable content. A page-level shortcut leaves them alone, so Ctrl+Z undoes
 * the typing and the arrow keys move the caret.
 */
export function isTextEntry(el: Element | null | undefined): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  // `isContentEditable` where the browser has it; the attribute, inherited down
  // the tree, where it does not (jsdom).
  return el.isContentEditable === true || el.closest('[contenteditable]:not([contenteditable="false"])') !== null;
}
