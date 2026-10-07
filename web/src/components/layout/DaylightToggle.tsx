import { useTranslation } from 'react-i18next';
import { toggleDaylight } from '../../services/app/theme';
import { useSettings } from '../../state/SettingsProvider';

/**
 * One tap between the chosen theme and daylight (high contrast), for a screen
 * read in sunlight at the field. Pressed while daylight is in force, whichever
 * way it was chosen (here or in Settings, General, Theme).
 */
export function DaylightToggle() {
  const { t } = useTranslation();
  const { settings, update } = useSettings();
  const on = settings.theme === 'daylight';
  const label = t('settings.themeOption.daylight');
  return (
    <button
      type="button"
      onClick={() => update(toggleDaylight(settings.theme, settings.themeBeforeDaylight))}
      aria-pressed={on}
      aria-label={label}
      title={label}
      className={`rounded-lg px-2 py-1.5 text-sm xl:px-2.5 leading-none ring-1 ${
        on
          ? 'bg-accent-600 text-on-accent ring-accent-500 hover:bg-accent-500'
          : 'bg-raised text-ink ring-line/10 hover:bg-elevated'
      }`}
    >
      ☀︎
    </button>
  );
}
