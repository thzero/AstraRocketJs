import { fetchElevation, fetchWeather, sampleAt, type FetchOpts, type WeatherAnswer } from '../weather/openMeteo';

/** The forecast's 10 m wind at a site and hour, for a rail-exit check. */
export interface SurfaceWind {
  speedMs: number;
  /** The strongest gust in the hour before; null when the forecast has none. */
  gustMs: number | null;
  answer: WeatherAnswer;
  validUnix: number;
}

export async function fetchSurfaceWind(
  q: {
    latitudeDeg: number;
    longitudeDeg: number;
    /** The site, meters above sea level; null to take the terrain model's height. */
    siteM: number | null;
    date: string;
    hour: number;
    today: string;
    apiKey?: string;
  },
  o: FetchOpts = {},
): Promise<SurfaceWind | 'noHour' | 'noElevation'> {
  // The site's own height, so the answer is the wind there rather than at sea
  // level. A blank height whose lookup fails is asked for, not taken as 0.
  const siteM = q.siteM ?? (await fetchElevation(q.latitudeDeg, q.longitudeDeg, q.apiKey, o));
  if (siteM == null) return 'noElevation';
  const answer = await fetchWeather({ ...q, siteM }, o);
  const sample = sampleAt(answer.variants[0]!, answer.timezone, q.date, q.hour);
  if (!sample || sample.windSpeed == null) return 'noHour';
  return { speedMs: sample.windSpeed, gustMs: sample.windGust, answer, validUnix: sample.unix };
}
