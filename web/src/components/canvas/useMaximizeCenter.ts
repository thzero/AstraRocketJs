import { useEffect } from 'react';
import { useSettings } from '../../state/SettingsProvider';

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
  // does not depend on finding one small button. Ignored while a dialog is open:
  // dialogs take Escape for themselves, and this would close both at once.
  useEffect(() => {
    if (!maxed) return;
    const esc = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('[role="dialog"]')) return;
      update({ maximizeCenter: false });
    };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [maxed, update]);
  return { maxed, toggleMaxed };
}
