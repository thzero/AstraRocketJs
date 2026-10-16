import { UserKeyField } from '../common/UserKeyField';
import { weatherKeyStore } from '../../services/weather/weatherKey';

/** The Open-Meteo API key, for someone with a paid plan. Blank is the free tier. */
export function WeatherKeyField() {
  return (
    <UserKeyField
      store={weatherKeyStore}
      label="weather.keyLabel"
      placeholder="weather.keyPlaceholder"
      note="weather.keyNote"
      notSaved="weather.keyNotSaved"
    />
  );
}
