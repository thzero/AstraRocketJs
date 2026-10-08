import { useTranslation } from 'react-i18next';
import type { AltitudeReference, DistanceUnit } from '../../services/exports/flightPathExport';

/** The flight-path export dialog's form building blocks. */

const UNITS: DistanceUnit[] = ['m', 'ft', 'km', 'mi'];

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl bg-raised/40 p-3 ring-1 ring-line/10">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">{title}</h3>
      <div className="space-y-1.5">{children}</div>
    </section>
  );
}

/** One of the two altitude-reference dropdowns: the track's, and the pins'. */
export function AltitudeRefSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: AltitudeReference;
  onChange: (v: AltitudeReference) => void;
}) {
  const { t } = useTranslation();
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-xs text-ink-muted">{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value as AltitudeReference)}
        className="w-40 rounded-md bg-raised px-2 py-1 text-sm text-ink-strong ring-1 ring-line/10 focus:outline-none focus:ring-accent-500"
      >
        <option value="automatic">{t('pathExport.altRef.automatic')}</option>
        <option value="ground">{t('pathExport.altRef.ground')}</option>
        <option value="sealevel">{t('pathExport.altRef.sealevel')}</option>
        <option value="clamped">{t('pathExport.altRef.clamped')}</option>
      </select>
    </label>
  );
}

export function UnitRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: DistanceUnit;
  onChange: (u: DistanceUnit) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-xs text-ink-muted">{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value as DistanceUnit)}
        className="w-24 rounded-md bg-raised px-2 py-1 text-sm text-ink-strong ring-1 ring-line/10 focus:outline-none focus:ring-accent-500"
      >
        {UNITS.map((u) => (
          <option key={u} value={u}>
            {u}
          </option>
        ))}
      </select>
    </label>
  );
}
