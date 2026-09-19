import { useTranslation } from 'react-i18next';
import { useWorkspaceStore } from '../../state/store';

/**
 * Desktop tab strip, rendered INSIDE the header (hidden below lg, where
 * {@link TabBar}'s bottom bar does the same job with the Design tab split in
 * two).
 *
 * Three tabs for the three things you are ever doing: changing geometry,
 * managing the runs over it, reading one back. Each one owns the whole width and
 * picks its own column layout, which is what freed the right column for the
 * property editor (see App.tsx).
 *
 * It used to be a strip of its own below the header, which cost a second full
 * row to hold two or three words while the header beside it sat almost empty
 * from the badges to the far-right controls. Sitting in that gap, the tabs cost
 * no height at all. `self-stretch` with a negating `-my-3` against the header's
 * `py-3` makes the nav exactly as tall as the header, so the active tab's
 * underline lands on the header's own bottom border and still reads as
 * continuous with the pane it labels.
 *
 * The phone keeps its bottom bar: a header this narrow already wraps, and a
 * horizontal tab row in it would wrap to the second row it was meant to save.
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
    <nav aria-label={t('tabs.workbench')} className="-my-3 ml-4 hidden self-stretch items-stretch gap-1 lg:flex">
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
      // A bottom border rather than a fill: the tab sits directly above the
      // panes it labels, so the active one should read as continuous with them.
      // `-mb-px` pulls it over the header's border rather than stacking on it.
      className={`-mb-px flex items-center border-b-2 px-4 text-sm font-semibold ${
        active
          ? 'border-sky-500 text-sky-300'
          : 'border-transparent text-slate-400 hover:border-white/20 hover:text-slate-200'
      }`}
    >
      {label}
    </button>
  );
}
