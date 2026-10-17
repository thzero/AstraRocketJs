import type { RocketTree } from '../../engine/openRocketEngine';
import { simulateInWorker } from '../../engine/simClient';
import type { WeatherSource } from '../design/orkTree';
import { fetchWeather, HOUR_OFFSETS, sampleAtUnix, ymdInZone, type FetchOpts } from '../weather/openMeteo';
import { proposalFor, proposalPatch } from '../weather/weatherProposal';
import type { FlightConfig } from './flightConfigs';
import { landingPoint, type GroundPoint } from './groundTrack';
import type { CompleteLaunch } from './requiredLaunch';
import { freshSeed, simConditions, type SimPrefs } from './simulations';
import { flightBranches } from './flightColumns';
import { launchLimitViolations, type LimitViolation } from './safetyLimits';
import type { PowerClass } from './powerClass';

/**
 * How a designed rocket's landing moves over the hours around the forecast its
 * conditions came from: the same design flown by the engine under each hour's
 * forecast, with everything else as the simulation has it. The Environment
 * view's landing section asks for it; nothing runs until it does.
 */

export interface HourLanding {
  /** Hours from the forecast hour the simulation used. */
  offset: number;
  /** When that hour starts, ms since the epoch. */
  validMs: number;
  /** One landing per flight branch (stage), meters east and north of the pad. */
  landings: (GroundPoint | null)[];
  /**
   * How that hour's conditions fall outside the safety codes. Such an hour is
   * not flown and has no landings, the same refusal a run and a wind sweep make.
   */
  outsideLimits?: LimitViolation[];
}

/**
 * Why an hour was not flown: one i18n key per safety code it breaks, empty
 * for an hour that flew.
 */
export const refusalKeys = (h: HourLanding): string[] =>
  (h.outsideLimits ?? []).map((v) => (v.field === 'windSpeed' ? 'env.landing.overWind' : 'env.landing.overRodAngle'));

/**
 * Fly each hour. Hours the held forecast does not cover are left out, and an
 * hour outside the safety codes is listed without flying it. The same random
 * seed for every hour, so turbulence does not pass for the wind changing.
 * `powerClass` is the class of the rocket `config` flies, which sets the
 * launcher angle the codes allow. Throws `WeatherError` if the forecast cannot
 * be had; rejects if `signal` aborts.
 */
export async function flyForecastHours(
  q: {
    tree: RocketTree;
    config: FlightConfig;
    launch: CompleteLaunch;
    source: WeatherSource;
    prefs: SimPrefs;
    powerClass: PowerClass;
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
    const sample = sampleAtUnix(variant, validUnix + offset * 3600);
    return sample ? [{ offset, sample }] : [];
  });
  let done = 0;
  q.onProgress?.(0, hours.length);
  // One failed hour fails the whole answer, so the flights still in the worker
  // pool are canceled with it rather than flown for results nobody reads. The
  // caller's signal cancels them too.
  const ctl = new AbortController();
  const cancel = () => ctl.abort(o.signal?.reason);
  if (o.signal?.aborted) cancel();
  else o.signal?.addEventListener('abort', cancel, { once: true });
  const flyHour = async ({ offset, sample }: (typeof hours)[number]): Promise<HourLanding> => {
    const patch = proposalPatch(
      proposalFor(sample, variant.elevationM),
      groups,
      source.elevationApplied ? { launchAltitudeM: variant.elevationM } : undefined,
    );
    const { weatherSource: _source, ...launch } = { ...q.launch, ...patch } as CompleteLaunch;
    const validMs = sample.unix * 1000;
    const outsideLimits = launchLimitViolations(launch, q.powerClass);
    if (outsideLimits.length) {
      q.onProgress?.(++done, hours.length);
      return { offset, validMs, landings: [], outsideLimits };
    }
    const result = await simulateInWorker(
      {
        tree: q.tree,
        config: q.config,
        options: { ...simConditions(launch, { ...q.prefs, randomSeed: seed }), series: 'summary' },
        // Sent with each flight, as a run sends it: the worker's unit must not
        // depend on whether the main-thread build has caught up.
        lengthUnit: q.prefs.lengthUnit,
      },
      { signal: ctl.signal },
    );
    const branches = flightBranches(result);
    q.onProgress?.(++done, hours.length);
    return { offset, validMs, landings: branches.map((b) => landingPoint(b.series)) };
  };
  try {
    const out = await Promise.all(
      hours.map((h) =>
        flyHour(h).catch((e: unknown) => {
          ctl.abort();
          throw e;
        }),
      ),
    );
    return out.sort((a, b) => a.offset - b.offset);
  } finally {
    o.signal?.removeEventListener('abort', cancel);
  }
}
