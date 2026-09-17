import { afterEach } from 'vitest';
import { cleanup, render, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
import { SettingsProvider } from '../state/SettingsProvider';
import '../i18n';

// RTL only auto-cleans when Vitest's globals are on, and this project imports
// `describe`/`it`/`expect` explicitly instead. Without this every render piles
// up in the same document and queries start matching the previous test's DOM.
afterEach(cleanup);

/**
 * Render a component inside the providers it needs, for `.test.tsx` component
 * tests (see vitest.config.ts for when to write one).
 *
 * Importing `../i18n` initializes real translations rather than stubbing `t`,
 * so a test can assert on the strings a user actually sees — and a missing or
 * renamed key shows up as a failing test rather than as a raw key on screen.
 *
 * Settings come from `SettingsProvider`, which reads localStorage
 * synchronously. Seed a starting state by writing the store before rendering
 * (see `seedSettings`); otherwise the component gets the app defaults.
 */
export function renderWithProviders(ui: ReactElement): RenderResult {
  return render(<SettingsProvider>{ui}</SettingsProvider>);
}

/** The key `services/settings.ts` persists to. */
const SETTINGS_KEY = 'astrarrocketjs:settings:v1';

/**
 * Pre-load a partial settings blob. Partial on purpose: `loadSettings` fills
 * and validates the rest, so a test states only what it cares about and still
 * exercises the real load path.
 */
export function seedSettings(partial: Record<string, unknown>): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(partial));
}

/** Read the persisted settings back, to assert on what a component wrote. */
export function readSettings(): Record<string, unknown> {
  return JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Record<string, unknown>;
}
