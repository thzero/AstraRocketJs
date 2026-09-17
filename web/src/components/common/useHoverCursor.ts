import { useEffect } from 'react';

/** Paint (or clear) the pointer cursor for a hoverable 3D mesh. */
const setCursor = (on: boolean): void => {
  document.body.style.cursor = on ? 'pointer' : '';
};

/**
 * Hover cursor for canvas meshes, cleared on unmount.
 *
 * A mesh's pointer-over writes `document.body.style.cursor` and only its
 * matching pointer-out clears it — but R3F meshes unmount without firing
 * pointer-out. Switch views, or let an edit rebuild the piece list, while a
 * part is hovered and the whole app stays stuck showing a pointer until
 * something else is hovered and left. The canvas owns the cursor it set, so it
 * clears it when it goes away.
 *
 * Returns a stable setter, safe to use in JSX without re-memoizing.
 */
export function useHoverCursor(): (on: boolean) => void {
  useEffect(() => () => setCursor(false), []);
  return setCursor;
}
