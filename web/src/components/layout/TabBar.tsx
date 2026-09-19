import { useTranslation } from 'react-i18next';
import { useWorkspaceStore } from '../../state/store';

/**
 * Mobile bottom tab bar (hidden at lg+, where {@link WorkbenchTabs} sits under
 * the header instead).
 *
 * Four buttons over three tabs: the Design tab has two halves a phone can't show
 * at once, so Rocket and Sketch both open it and pick the half (`designPane`).
 * At lg+ that split disappears and Design is one button showing both.
 *
 * It is the last flex child of a fixed-height column whose main area is
 * `overflow-hidden`, so it stays put while a pane scrolls behind it. The
 * bottom padding is the home-indicator inset: `index.html` asks for
 * `viewport-fit=cover`, which lets the page run under that bar, and without it
 * the tab labels sit beneath it on an iPhone.
 */
export function TabBar() {
  const { t } = useTranslation();
  const tab = useWorkspaceStore((s) => s.tab);
  const pane = useWorkspaceStore((s) => s.designPane);
  const onTab = useWorkspaceStore((s) => s.setTab);
  const onPane = useWorkspaceStore((s) => s.setDesignPane);
  // Results only exist once SOME simulation has produced one, so the tab comes
  // and goes with that rather than sitting there empty. Any sim, not the active
  // one: switching to a never-run simulation should not take the tab away, and
  // the pane says "not run yet" for that row on its own.
  //
  // A design edit no longer takes it away either -- results are flagged
  // outdated, not destroyed -- so this now only fires on New / Open, where
  // `|| tab === 'results'` keeps the tab under anyone standing on it.
  const hasResult = useWorkspaceStore((s) => s.sims.some((x) => !!x.result));
  const showResults = hasResult || tab === 'results';
  return (
    <nav className="flex shrink-0 border-t border-white/10 bg-slate-900/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
      <TabButton
        active={tab === 'design' && pane === 'stats'}
        onClick={() => onPane('stats')}
        label={t('tabs.rocket')}
        icon="🚀"
      />
      <TabButton
        active={tab === 'design' && pane === 'sketch'}
        onClick={() => onPane('sketch')}
        label={t('tabs.sketch')}
        icon="📐"
      />
      <TabButton active={tab === 'sim'} onClick={() => onTab('sim')} label={t('tabs.simulate')} icon="📈" />
      {showResults && (
        <TabButton active={tab === 'results'} onClick={() => onTab('results')} label={t('tabs.results')} icon="📊" />
      )}
    </nav>
  );
}

function TabButton({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: string;
}) {
  return (
    <button
      onClick={onClick}
      // Which tab you are on was signalled by color alone — nothing a screen
      // reader could announce, and nothing a low-vision user could rely on.
      aria-current={active ? 'page' : undefined}
      className={`flex flex-1 flex-col items-center gap-0.5 py-3 text-xs ${active ? 'text-sky-400' : 'text-slate-400'}`}
    >
      <span className="text-lg">{icon}</span>
      {label}
    </button>
  );
}
