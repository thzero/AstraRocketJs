import { useTranslation } from 'react-i18next';
import { useWorkspaceStore } from '../../state/store';
import { useShowResultsTab } from './useShowResultsTab';

/**
 * Desktop tab strip, rendered INSIDE the header (hidden below lg, where
 * {@link TabBar}'s bottom bar does the same job with the Design tab split in
 * two).
 *
 * Four tabs for the four things you are ever doing: changing geometry, setting
 * up the motors it flies on, managing the runs over it, reading one back. Each one owns the whole width and
 * picks its own column layout, which is what freed the right column for the
 * property editor (see App.tsx).
 *
 * Inside the header rather than a strip below it, so the tabs cost no height: they
 * sit in the gap between the badges and the far-right controls. `self-stretch` with
 * a negating `-my-3` against the header's `py-3` makes the nav exactly as tall as
 * the header, so the active tab's underline lands on the header's own bottom border
 * and reads as continuous with the pane it labels.
 *
 * The phone keeps its bottom bar: a header this narrow already wraps, and a
 * horizontal tab row in it would wrap to the second row it was meant to save.
 */
export function WorkbenchTabs() {
  const { t } = useTranslation();
  const tab = useWorkspaceStore((s) => s.tab);
  const onTab = useWorkspaceStore((s) => s.setTab);
  const showResults = useShowResultsTab();

  return (
    <nav aria-label={t('tabs.workbench')} className="-my-3 ml-4 hidden self-stretch items-stretch gap-1 lg:flex">
      <TabButton active={tab === 'design'} onClick={() => onTab('design')} label={t('tabs.design')} />
      <TabButton active={tab === 'configs'} onClick={() => onTab('configs')} label={t('tabs.configs')} />
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
      // A bottom border rather than a fill: the tab sits directly above the
      // panes it labels, so the active one should read as continuous with them.
      // `-mb-px` pulls it over the header's border rather than stacking on it.
      className={`-mb-px flex items-center border-b-2 px-3 text-sm font-semibold ${
        active
          ? 'border-sky-500 text-sky-300'
          : 'border-transparent text-slate-400 hover:border-white/20 hover:text-slate-200'
      }`}
    >
      {label}
    </button>
  );
}
