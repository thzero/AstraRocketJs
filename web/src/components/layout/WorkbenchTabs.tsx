import { useTranslation } from 'react-i18next';
import { useWorkspaceStore } from '../../state/store';

/**
 * Desktop tab strip, under the header (hidden below lg, where {@link TabBar}'s
 * bottom bar does the same job with the Design tab split in two).
 *
 * Three tabs for the three things you are ever doing: changing geometry,
 * managing the runs over it, reading one back. Each one owns the whole width and
 * picks its own column layout, which is what freed the right column for the
 * property editor (see App.tsx).
 */
export function WorkbenchTabs() {
  const { t } = useTranslation();
  const tab = useWorkspaceStore((s) => s.tab);
  const onTab = useWorkspaceStore((s) => s.setTab);
  // Same rule as the mobile bar: Results appears with the first result and stays
  // while you are standing on it.
  const hasResult = useWorkspaceStore((s) => s.sims.some((x) => !!x.result));
  const showResults = hasResult || tab === 'results';

  return (
    <nav
      aria-label={t('tabs.workbench')}
      className="hidden shrink-0 gap-1 border-b border-white/10 bg-slate-900/60 px-3 lg:flex"
    >
      <TabButton active={tab === 'design'} onClick={() => onTab('design')} label={t('tabs.design')} />
      <TabButton active={tab === 'sim'} onClick={() => onTab('sim')} label={t('tabs.simulations')} />
      {showResults && (
        <TabButton active={tab === 'results'} onClick={() => onTab('results')} label={t('tabs.results')} />
      )}
    </nav>
  );
}

function TabButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      // A bottom border rather than a fill: the strip sits directly on the panes
      // it labels, so the active tab should read as continuous with them.
      className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${
        active
          ? 'border-sky-500 text-sky-300'
          : 'border-transparent text-slate-400 hover:border-white/20 hover:text-slate-200'
      }`}
    >
      {label}
    </button>
  );
}
