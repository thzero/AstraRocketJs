import type { RocketTree } from '../../engine/openRocketEngine';
import { simulateInWorker } from '../../engine/simClient';
import type { WeatherSource } from '../design/orkTree';
import { fetchWeather, ymdInZone, type FetchOpts } from '../weather/openMeteo';
import { proposalFor, proposalPatch } from '../weather/weatherProposal';
import type { FlightConfig } from './flightConfigs';
import { landingPoint, type GroundPoint } from './groundTrack';
import type { CompleteLaunch } from './requiredLaunch';
import { freshSeed, simConditions, type SimPrefs } from './simulations';

/**
 * How a designed rocket's landing moves over the hours around the forecast its
 * conditions came from: the same design flown by the engine under each hour's
 * forecast, with everything else as the simulation has it. The Environment
 * view's landing section asks for it; nothing runs until it does.
 */

/** The hours flown, relative to the forecast hour the simulation used. */
export const HOUR_OFFSETS = [-2, -1, 0, 1, 2] as const;

export interface HourLanding {
  /** Hours from the forecast hour the simulation used. */
  offset: number;
  /** When that hour starts, ms since the epoch. */
  validMs: number;
  /** One landing per flight branch (stage), meters east and north of the pad. */
  landings: (GroundPoint | null)[];
}

/**
 * Fly each hour. Hours the held forecast does not cover are left out. The
 * same random seed for every hour, so turbulence does not pass for the wind
 * changing. Throws `WeatherError` if the forecast cannot be had; rejects if
 * `signal` aborts.
 */
export async function flyForecastHours(
  q: {
    tree: RocketTree;
    config: FlightConfig;
    launch: CompleteLaunch;
    source: WeatherSource;
    prefs: SimPrefs;
    apiKey?: string;
    onProgress?: (done: number, total: number) => void;
  },
  o: FetchOpts = {},
): Promise<HourLanding[]> {
  const { source } = q;
  const answer = await fetchWeather(
    {
      latitudeDeg: source.latitudeDeg,
      longitudeDeg: source.longitudeDeg,
      siteM: source.elevationM,
      date: source.date,
      today: ymdInZone((o.now ?? Date.now)(), source.timezone),
      apiKey: q.apiKey,
    },
    o,
  );
  const variant = answer.variants.find((v) => Math.abs(v.elevationM - source.elevationM) < 0.5) ?? answer.variants[0]!;
  const validUnix = Date.parse(source.validAt) / 1000;
  const groups = new Set(source.groups);
  const seed = q.prefs.randomSeed ?? freshSeed();

  const hours = HOUR_OFFSETS.flatMap((offset) => {
    const sample = variant.samples.find((s) => s.unix === validUnix + offset * 3600);
    return sample ? [{ offset, sample }] : [];
  });
  let done = 0;
  q.onProgress?.(0, hours.length);
  const out = await Promise.all(
    hours.map(async ({ offset, sample }): Promise<HourLanding> => {
      const patch = proposalPatch(
        proposalFor(sample, variant.elevationM),
        groups,
        source.elevationApplied ? { launchAltitudeM: variant.elevationM } : undefined,
      );
      const { weatherSource: _source, ...launch } = { ...q.launch, ...patch } as CompleteLaunch;
      const result = await simulateInWorker(
        {
          tree: q.tree,
          config: q.config,
          options: { ...simConditions(launch as CompleteLaunch, { ...q.prefs, randomSeed: seed }), series: 'summary' },
        },
        { signal: o.signal },
      );
      const branches = result.branches?.length ? result.branches : [{ series: result.series }];
      q.onProgress?.(++done, hours.length);
      return { offset, validMs: sample.unix * 1000, landings: branches.map((b) => landingPoint(b.series)) };
    }),
  );
  return out.sort((a, b) => a.offset - b.offset);
}
