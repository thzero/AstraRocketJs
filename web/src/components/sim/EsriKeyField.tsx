import { UserKeyField } from '../common/UserKeyField';
import { esriKeyStore } from '../../services/map/esriKey';

/**
 * The user's own Esri API key, for the site map and the flight views' imagery.
 * Blank requests the tiles with no token.
 */
export function EsriKeyField() {
  return (
    <UserKeyField
      store={esriKeyStore}
      label="map.keyLabel"
      placeholder="map.keyPlaceholder"
      note="map.keyNote"
      notSaved="map.keyNotSaved"
    />
  );
}
