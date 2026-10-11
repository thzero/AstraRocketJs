import { describe, it, expect } from 'vitest';
import en from '../../../src/i18n/locales/en.json';
import { simStatusLabel, type SimStatus } from '../../../src/services/flight/simulations';
import { localeTranslator } from '../../testing/localeTranslator';

/**
 * The simulations table and the run-table CSV both name a row's status through
 * `simStatusLabel`, so the two cannot drift apart.
 */
describe('simStatusLabel', () => {
  const t = localeTranslator(en);
  const all: SimStatus[] = ['upToDate', 'outdated', 'queued', 'running', 'failed', 'notRun', 'fromFile'];

  it('gives every status its own translated wording', () => {
    const labels = all.map((s) => simStatusLabel(s, t));
    expect(labels).toEqual([
      en.sims.statusUpToDate,
      en.sims.statusOutdated,
      en.sims.statusQueued,
      en.sims.statusRunning,
      en.sims.statusFailed,
      en.sims.notRun,
      en.sims.statusFromFile,
    ]);
    expect(new Set(labels).size).toBe(all.length);
  });
});
