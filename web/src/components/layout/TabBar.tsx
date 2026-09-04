import { useTranslation } from 'react-i18next';
import { useWorkspaceStore } from '../../state/store';

export type Tab = 'build' | 'sim';

/** Mobile bottom tab bar (hidden at lg+, where the panes sit side by side). */
export function TabBar() {
  const { t } = useTranslation();
  const tab = useWorkspaceStore((s) => s.tab);
  const onTab = useWorkspaceStore((s) => s.setTab);
  return (
    <nav className="flex border-t border-white/10 bg-slate-900/95 backdrop-blur lg:hidden">
      <TabButton active={tab === 'build'} onClick={() => onTab('build')} label={t('tabs.rocket')} icon="🚀" />
      <TabButton active={tab === 'sim'} onClick={() => onTab('sim')} label={t('tabs.simulate')} icon="📈" />
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
      className={`flex flex-1 flex-col items-center gap-0.5 py-3 text-xs ${active ? 'text-sky-400' : 'text-slate-400'}`}
    >
      <span className="text-lg">{icon}</span>
      {label}
    </button>
  );
}
