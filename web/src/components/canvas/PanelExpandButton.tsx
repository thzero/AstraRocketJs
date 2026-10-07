import { useTranslation } from 'react-i18next';

/**
 * A flight chart panel's own expand toggle: one panel takes the pane's height,
 * or every chosen panel comes back. In the panel header, beside its value.
 */
export function PanelExpandButton({ expanded, onClick }: { expanded: boolean; onClick: () => void }) {
  const { t } = useTranslation();
  const label = expanded ? t('flight.showAllPanels') : t('flight.expandPanel');
  return (
    <button
      onClick={onClick}
      // A press here must not start a pan or move the crosshair on the host.
      onPointerDown={(e) => e.stopPropagation()}
      aria-pressed={expanded}
      aria-label={label}
      title={label}
      className="rounded px-1 text-[11px] leading-none text-slate-400 hover:bg-slate-700 hover:text-slate-100"
    >
      {expanded ? '⤡' : '⤢'}
    </button>
  );
}
