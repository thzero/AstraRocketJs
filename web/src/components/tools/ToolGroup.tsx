import { useTranslation } from 'react-i18next';

/** One titled card of a tool's form. */
export function ToolGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl bg-slate-900 p-3 ring-1 ring-white/10">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</h3>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

/** Open-Meteo's credit and license, under anything a tool shows from it. */
export function OpenMeteoCredit() {
  const { t } = useTranslation();
  return (
    <p className="text-[11px] text-slate-500">
      <a className="text-sky-400 hover:underline" href="https://open-meteo.com/" target="_blank" rel="noreferrer">
        {t('weather.credit')}
      </a>
      {' · '}
      <a
        className="text-sky-400 hover:underline"
        href="https://creativecommons.org/licenses/by/4.0/"
        target="_blank"
        rel="noreferrer"
      >
        CC BY 4.0
      </a>
    </p>
  );
}
