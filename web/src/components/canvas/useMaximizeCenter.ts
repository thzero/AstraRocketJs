import { useEffect } from 'react';
import { useSettings } from '../../state/SettingsProvider';
import { hasOpenSurface } from '../common/useFocusTrap';

/**
 * Give the drawing the whole window: both side columns step aside (App.tsx
 * reads the same flag). An airframe is far longer than it is wide, so the
 * horizontal space is what it is short of.
 */
export function useMaximizeCenter() {
  const { settings, update } = useSettings();
  const maxed = settings.maximizeCenter;
  const toggleMaxed = () => update({ maximizeCenter: !maxed });
  // Escape gets out, because a mode that hides two panels needs a way back that
  // does not depend on finding one small button. Ignored while any modal surface
  // is open, alerts included: they take Escape for themselves, and this would
  // close both at once. An Escape already spent (an open menu closing) is
  // ignored for the same reason.
  useEffect(() => {
    if (!maxed) return;
    const esc = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || hasOpenSurface()) return;
      update({ maximizeCenter: false });
    };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [maxed, update]);
  return { maxed, toggleMaxed };
}
