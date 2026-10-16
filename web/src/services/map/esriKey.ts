import { userKeyStore } from '../storage/userKey';

/**
 * The user's own Esri API key, or none.
 *
 * Each user may create one on their own free ArcGIS Location Platform account
 * and enter it in Settings; the map's tile requests then carry it, as Esri's own
 * Leaflet library sends it. With none, the tiles are requested with no token.
 */
export const esriKeyStore = userKeyStore('esri:apikey');

export const useEsriKey = esriKeyStore.use;
