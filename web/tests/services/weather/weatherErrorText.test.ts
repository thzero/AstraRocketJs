import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { weatherErrorText } from '../../../src/services/weather/weatherErrorText';
import { WeatherError } from '../../../src/services/weather/openMeteo';

const t = (key: string, opts?: Record<string, unknown>) =>
  typeof opts?.['detail'] === 'string' ? `${key}(${opts['detail']})` : key;

describe('weatherErrorText', () => {
  it('explains a refused date in its own words', () => {
    expect(weatherErrorText(new WeatherError('refused', 'tooFarAhead'), t)).toBe('weather.dateRefusal.tooFarAhead');
  });

  it('names any other weather failure by kind, and the rest by the fallback', () => {
    expect(weatherErrorText(new WeatherError('refused', 'quota'), t)).toBe('weather.error.refused(quota)');
    expect(weatherErrorText(new Error('x'), t)).toBe('weather.error.offline');
    expect(weatherErrorText(new Error('x'), t, 'env.landing.failed')).toBe('env.landing.failed');
  });

  // The app's own notes on a malformed answer are English; they stay in the
  // error message for the logs and never reach a translated sentence.
  it('keeps the app-built detail of a malformed answer out of the user text', () => {
    expect(weatherErrorText(new WeatherError('shape', 'no hourly data'), t)).toBe('weather.error.shape');
    expect(weatherErrorText(new WeatherError('units', 'temperature_2m in °F'), t)).toBe('weather.error.units');
    expect(weatherErrorText(new WeatherError('http', '502'), t)).toBe('weather.error.http(502)');
  });

  it('is the only place the date refusals are worded', () => {
    const src = resolve(__dirname, '../../../src');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) {
          if (entry !== 'vendor' && entry !== 'locales') walk(path);
        } else if (
          /\.tsx?$/.test(entry) &&
          !entry.startsWith('weatherErrorText') &&
          /weather\.dateRefusal\./.test(readFileSync(path, 'utf8'))
        ) {
          offenders.push(path.slice(src.length + 1));
        }
      }
    };
    walk(src);
    expect(offenders).toEqual([]);
  });
});

/** The CC BY 4.0 credit is one component, so the license line cannot drift. */
describe('the Open-Meteo credit', () => {
  it('is written in one place', () => {
    const src = resolve(__dirname, '../../../src');
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) {
          if (entry !== 'vendor' && entry !== 'locales') walk(path);
        } else if (
          /\.tsx?$/.test(entry) &&
          readFileSync(path, 'utf8').includes('https://creativecommons.org/licenses/by/4.0')
        ) {
          hits.push(
            path
              .slice(src.length + 1)
              .split(sep)
              .join('/'),
          );
        }
      }
    };
    walk(src);
    expect(hits).toEqual(['components/common/OpenMeteoCredit.tsx']);
  });
});
