import { useTranslation } from 'react-i18next';
import { useWorkspaceStore } from '../../state/store';
import { useShowResultsTab } from './useShowResultsTab';
import { taskTabs } from './tabTable';

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
    <nav aria-label={t('tabs.workbench')} className="-my-3 ml-3 hidden self-stretch items-stretch gap-1 lg:flex">
      <TabButton active={tab === 'design'} onClick={() => onTab('design')} label={t('tabs.design')} />
      {taskTabs(showResults).map((e) => (
        <TabButton
          key={e.id}
          active={tab === e.id}
          onClick={() => onTab(e.id)}
          label={t(e.label)}
          glyph={e.narrowGlyph ? e.icon : undefined}
        />
      ))}
    </nav>
  );
}

function TabButton({
  active,
  onClick,
  label,
  glyph,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  /** Shown in place of the word below 2xl; the word stays the button's name. */
  glyph?: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={glyph ? label : undefined}
      title={glyph ? label : undefined}
      aria-current={active ? 'page' : undefined}
      // A bottom border rather than a fill: the tab sits directly above the
      // panes it labels, so the active one should read as continuous with them.
      // `-mb-px` pulls it over the header's border rather than stacking on it.
      // Tighter below 2xl: with five tabs the header row has no slack left at
      // 1024 in English or 1280 in Portuguese (workbench-header.spec.ts).
      className={`-mb-px flex items-center border-b-2 px-2 text-sm font-semibold 2xl:px-3 ${
        active
          ? 'border-sky-500 text-sky-300'
          : 'border-transparent text-slate-400 hover:border-white/20 hover:text-slate-200'
      }`}
    >
      {glyph ? (
        <>
          <span aria-hidden="true" className="2xl:hidden">
            {glyph}
          </span>
          <span aria-hidden="true" className="hidden 2xl:inline">
            {label}
          </span>
        </>
      ) : (
        label
      )}
    </button>
  );
}
