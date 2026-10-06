import { useTranslation } from 'react-i18next';

const input =
  'rounded-md bg-slate-800 px-2 py-1 text-sm text-slate-100 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500';

/**
 * A forecast's date and hour, in the site's local time. `rows` puts each on
 * its own labeled row (the tools' forms); `inline` stacks each label over its
 * control, side by side (the weather dialog's toolbar).
 */
export function WhenFields({
  date,
  hour,
  onDate,
  onHour,
  layout = 'rows',
}: {
  date: string;
  hour: number;
  onDate: (d: string) => void;
  onHour: (h: number) => void;
  layout?: 'rows' | 'inline';
}) {
  const { t } = useTranslation();
  const label = layout === 'rows' ? 'flex items-center justify-between gap-3' : 'flex flex-col gap-1';
  return (
    <>
      <label className={label}>
        <span className="text-xs text-slate-400">{t('weather.dateLabel')}</span>
        <input type="date" className={input} value={date} onChange={(ev) => onDate(ev.target.value)} />
      </label>
      <label className={label}>
        <span className="text-xs text-slate-400">{t('weather.hourLabel')}</span>
        <select className={input} value={hour} onChange={(ev) => onHour(Number(ev.target.value))}>
          {Array.from({ length: 24 }, (_, h) => (
            <option key={h} value={h}>
              {String(h).padStart(2, '0')}:00
            </option>
          ))}
        </select>
      </label>
    </>
  );
}
