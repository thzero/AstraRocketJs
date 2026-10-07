import { useSettings } from '../../state/SettingsProvider';

/**
 * The CG/CP markers, the info card and the 2D rulers: user preferences that
 * persist across reloads, shared by the toolbar that toggles them and the
 * canvas that honors them.
 */
export function useViewPrefs() {
  const { settings, update } = useSettings();
  const rulers = settings.rulers;
  const toggleMarkers = () => update({ showMarkers: !settings.showMarkers });
  const toggleInfoCard = () => update({ showInfoCard: !settings.showInfoCard });
  const toggleRulerSide = (side: keyof typeof rulers) =>
    update({ rulers: { ...settings.rulers, [side]: !settings.rulers[side] } });
  return {
    showMarkers: settings.showMarkers,
    showInfoCard: settings.showInfoCard,
    rulers,
    toggleMarkers,
    toggleInfoCard,
    toggleRulerSide,
  };
}
