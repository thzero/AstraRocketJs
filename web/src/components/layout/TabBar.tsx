import { useTranslation } from 'react-i18next';
import { useWorkspaceStore } from '../../state/store';
import { useShowResultsTab } from './useShowResultsTab';
import { taskTabs } from './tabTable';

/**
 * Mobile bottom tab bar (hidden at lg+, where {@link WorkbenchTabs} sits under
 * the header instead).
 *
 * One more button than there are tabs: the Design tab has two halves a phone
 * can't show at once, so Rocket and Sketch both open it and pick the half
 * (`designPane`). At lg+ that split disappears and Design is one button showing
 * both.
 *
 * The labels are shorter here than in the header strip, because five or six of
 * them share the width of a phone: `tabs.configsShort` names the tab that the desktop
 * calls Configurations.
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
  const showResults = useShowResultsTab();
  return (
    <nav className="flex shrink-0 border-t border-line/10 bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
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
      {taskTabs(showResults).map((e) => (
        <TabButton key={e.id} active={tab === e.id} onClick={() => onTab(e.id)} label={t(e.short)} icon={e.icon} />
      ))}
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
      // Which tab you are on is announced (`aria-current`), not shown by color
      // alone, which a screen reader cannot announce and a low-vision user
      // cannot rely on.
      aria-current={active ? 'page' : undefined}
      className={`flex flex-1 flex-col items-center gap-0.5 py-3 text-xs ${active ? 'text-accent-400' : 'text-ink-muted'}`}
    >
      <span className="text-lg">{icon}</span>
      {label}
    </button>
  );
}
