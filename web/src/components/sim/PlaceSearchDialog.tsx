import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '../common/Dialog';
import { DialogButton } from '../common/DialogButton';
import { GeoNamesCredit } from '../common/OpenMeteoCredit';
import { useLatest } from '../common/useLatest';
import { useUnits } from '../../prefs/useUnits';
import { unitScope } from '../../prefs/units';
import { LAUNCH_SI } from '../../prefs/launchUnits';
import { formatCoord } from '../../services/map/slippyMap';
import { parseCoordinateText } from '../../services/map/coordinateText';
import { fetchElevation, searchPlaces, type PlaceMatch } from '../../services/weather/openMeteo';
import { readWeatherKey } from '../../services/weather/weatherKey';
import { weatherErrorText } from '../../services/weather/weatherErrorText';
import { useOnline } from '../common/useOnline';

/** What choosing a place writes into the site: elevation only when one is known. */
export interface PlacePick {
  latitudeDeg: number;
  longitudeDeg: number;
  launchAltitudeM?: number;
}

/** A row the dialog offers. Pasted coordinates are one row whose elevation is looked up. */
interface Row {
  key: string;
  title: string;
  detail: string | null;
  latitudeDeg: number;
  longitudeDeg: number;
  /** undefined while the lookup runs; null when there is none. */
  elevationM: number | null | undefined;
}

type State =
  { kind: 'idle' } | { kind: 'searching' } | { kind: 'rows'; rows: Row[] } | { kind: 'message'; text: string };

const placeRow = (p: PlaceMatch, i: number): Row => ({
  key: `${i}:${p.latitudeDeg},${p.longitudeDeg}`,
  title: p.name,
  detail: [p.region, p.country].filter(Boolean).join(', ') || null,
  latitudeDeg: p.latitudeDeg,
  longitudeDeg: p.longitudeDeg,
  elevationM: p.elevationM,
});

/**
 * Find the launch site by name, postal code, coordinates or map link.
 *
 * A name or postal code goes to Open-Meteo's geocoding, through the same
 * transport as the weather, so the request names neither this app nor its
 * site. Coordinates and map links are read here and never sent anywhere; only
 * the elevation at them is looked up, the way the weather dialog does.
 *
 * It sets the site, not the weather: the forecast, the map and the flight all
 * read the site, so they stay on one place. Choosing a row writes the three
 * site fields as one undoable edit, through the caller.
 */
export function PlaceSearchDialog({ onPick, onClose }: { onPick: (pick: PlacePick) => void; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const altUnit = useUnits().at(unitScope('launch', 'altitude'), LAUNCH_SI.distance.q);
  const [query, setQuery] = useState('');
  const [state, setState] = useState<State>({ kind: 'idle' });
  const request = useLatest();
  const online = useOnline();
  // Coordinates and map links are read here; only a name or a postal code is sent.
  const needsNetwork = query.trim() !== '' && parseCoordinateText(query) === null;
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);

  const search = async () => {
    const text = query.trim();
    if (text === '') return;
    const signal = request.claimSignal();
    const parsed = parseCoordinateText(text);
    if (parsed?.kind === 'shortLink') {
      setState({ kind: 'message', text: t('placeSearch.shortLink') });
      return;
    }
    if (parsed) {
      const row: Row = {
        key: 'coords',
        title: t('placeSearch.coords'),
        detail: null,
        latitudeDeg: parsed.latitudeDeg,
        longitudeDeg: parsed.longitudeDeg,
        elevationM: undefined,
      };
      setState({ kind: 'rows', rows: [row] });
      const elevationM = await fetchElevation(parsed.latitudeDeg, parsed.longitudeDeg, readWeatherKey(), {
        signal,
      }).catch(() => null);
      if (!signal.aborted) setState({ kind: 'rows', rows: [{ ...row, elevationM }] });
      return;
    }
    setState({ kind: 'searching' });
    try {
      const places = await searchPlaces(text, i18n.language.slice(0, 2).toLowerCase(), readWeatherKey(), {
        signal,
      });
      if (signal.aborted) return;
      setState(
        places.length === 0
          ? { kind: 'message', text: t('placeSearch.none') }
          : { kind: 'rows', rows: places.map(placeRow) },
      );
    } catch (err) {
      if (!signal.aborted) setState({ kind: 'message', text: weatherErrorText(err, t) });
    }
  };

  const elevationText = (e: number | null | undefined) =>
    e === undefined
      ? t('placeSearch.elevationLooking')
      : e === null
        ? t('placeSearch.elevationUnknown')
        : `${altUnit.fmt(e, 0)} ${altUnit.sym}`;

  return (
    <Dialog id="placeSearch" title={t('placeSearch.title')} onClose={onClose} layout="pad" size="md">
      <label htmlFor="place-search" className="mt-4 block text-xs font-medium text-ink-muted">
        {t('placeSearch.label')}
      </label>
      <div className="mt-1 flex gap-2">
        <input
          id="place-search"
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void search();
          }}
          placeholder={t('placeSearch.placeholder')}
          maxLength={2000}
          className="min-w-0 flex-1 rounded-lg bg-raised px-3 py-2 text-sm text-ink-strong ring-1 ring-line/10 focus:ring-accent-500"
        />
        <DialogButton
          onClick={() => void search()}
          disabled={query.trim() === '' || state.kind === 'searching' || (needsNetwork && !online)}
          title={needsNetwork && !online ? t('common.needsConnection') : undefined}
          variant="primary"
        >
          {state.kind === 'searching' ? t('placeSearch.searching') : t('placeSearch.search')}
        </DialogButton>
      </div>
      <p className="mt-1 text-[11px] text-ink-faint">{t('placeSearch.hint')}</p>

      {/* Mounted always, so what lands in it is announced. */}
      <div role="status" aria-live="polite" className="mt-3">
        {state.kind === 'message' && <p className="text-xs text-warn-300">{state.text}</p>}
        {state.kind === 'rows' && (
          <ul className="space-y-1">
            {state.rows.map((r) => (
              <li key={r.key}>
                <button
                  onClick={() =>
                    onPick({
                      latitudeDeg: r.latitudeDeg,
                      longitudeDeg: r.longitudeDeg,
                      ...(r.elevationM != null ? { launchAltitudeM: r.elevationM } : {}),
                    })
                  }
                  // Not before the elevation lookup has answered: picking then
                  // would write a site with the previous field's elevation under it.
                  disabled={r.elevationM === undefined}
                  className="w-full rounded-lg bg-raised/60 px-3 py-2 text-left ring-1 ring-line/10 hover:bg-elevated disabled:cursor-wait disabled:opacity-60"
                >
                  <span className="block text-sm text-ink-strong">
                    {r.title}
                    {r.detail && <span className="text-ink-muted"> · {r.detail}</span>}
                  </span>
                  <span className="block text-[11px] text-ink-muted">
                    {formatCoord(r.latitudeDeg, r.longitudeDeg)} · {elevationText(r.elevationM)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* GeoNames' license asks for the credit wherever its places are shown. */}
      <GeoNamesCredit className="mt-4 text-[11px] text-ink-faint" />

      <div className="mt-4 flex justify-end">
        <DialogButton onClick={onClose} variant="secondary">
          {t('common.cancel')}
        </DialogButton>
      </div>
    </Dialog>
  );
}
