import type { PartKey } from './partColors';

/**
 * App-wide user preferences (not tied to a design): 3D part-colour overrides,
 * flight-path phase colours, and the default playback speed. Persisted to
 * localStorage synchronously so the very first render already has the user's
 * choices. Consumed reactively via the SettingsProvider / useSettings hook.
 */
export interface Settings {
  /** Per-group colour overrides for the 3D model (empty = built-in defaults). */
  partColors: Partial<Record<PartKey, string>>;
  /** Flight-path phase colours. */
  phaseColors: { boost: string; coast: string; descent: string };
  /** Default flight-path playback speed (×). */
  playbackSpeed: number;
}

export const DEFAULT_SETTINGS: Settings = {
  partColors: {},
  phaseColors: { boost: '#fb923c', coast: '#38bdf8', descent: '#34d399' },
  playbackSpeed: 0.5,
};

const KEY = 'settings:v1';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const s = JSON.parse(raw) as Partial<Settings>;
    return {
      partColors: { ...(s.partColors ?? {}) },
      phaseColors: { ...DEFAULT_SETTINGS.phaseColors, ...(s.phaseColors ?? {}) },
      playbackSpeed: typeof s.playbackSpeed === 'number' ? s.playbackSpeed : DEFAULT_SETTINGS.playbackSpeed,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: Settings): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage disabled */ }
}
