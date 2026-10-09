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
      // The name says what a press does, so there is no aria-pressed: a
      // toggle's state and a changing name together read as "Show all panels,
      // pressed", which contradicts itself.
      aria-label={label}
      title={label}
      className="rounded px-1 text-[11px] leading-none text-ink-muted hover:bg-elevated hover:text-ink-strong"
    >
      {expanded ? '⤡' : '⤢'}
    </button>
  );
}
