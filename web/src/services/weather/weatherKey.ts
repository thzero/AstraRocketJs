import { userKeyStore } from '../storage/userKey';

/**
 * The user's Open-Meteo API key, from a paid plan, or none for the free tier.
 * Stored in this browser only (services/storage/userKey).
 */
export const weatherKeyStore = userKeyStore('openmeteo:apikey');

export const readWeatherKey = weatherKeyStore.read;
