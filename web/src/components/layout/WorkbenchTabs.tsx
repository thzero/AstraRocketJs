import { useTranslation } from 'react-i18next';
import { useWorkspaceStore } from '../../state/store';
import { useShowResultsTab } from './useShowResultsTab';
import { taskTabs } from './tabTable';

/**
 * Desktop tab strip, rendered inside the header (hidden below lg, where
 * {@link TabBar}'s bottom bar does the same job with the Design tab split in
 * two).
 *
 * One tab per job: changing geometry, setting up the motors it flies on,
 * managing the runs over it, reading one back, and the tools. Results shows only
 * while useShowResultsTab says so. Each one owns the whole width and picks its
 * own column layout, which leaves the right column free for the property editor
 * (see App.tsx).
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
    <nav
      aria-label={t('tabs.workbench')}
      className="-my-3 ml-2 hidden self-stretch items-stretch gap-0.5 lg:flex 2xl:ml-3 2xl:gap-1"
    >
      <TabButton active={tab === 'design'} onClick={() => onTab('design')} label={t('tabs.design')} />
      {taskTabs(showResults).map((e) => (
        <TabButton key={e.id} active={tab === e.id} onClick={() => onTab(e.id)} label={t(e.label)} />
      ))}
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
      // Tighter below 2xl, padding and gaps both: with five tabs spelled out the
      // header row has no slack left at 1024 in English or 1180 in Portuguese
      // (workbench-header.spec.ts).
      className={`-mb-px flex items-center border-b-2 px-1 text-sm font-semibold 2xl:px-3 ${
        active
          ? 'border-accent-500 text-accent-300'
          : 'border-transparent text-ink-muted hover:border-line/20 hover:text-ink'
      }`}
    >
      {label}
    </button>
  );
}
