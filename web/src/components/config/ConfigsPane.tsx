import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkspaceStore, selectEditedConfig } from '../../state/store';
import { confirm } from '../../state/confirmStore';
import { ConfigsTable } from './ConfigsTable';
import { ConfigEditor } from './ConfigEditor';
import { motorColumns, recoveryColumns, separationColumns } from './configColumns';
import { useIsDesktop } from '../common/useMediaQuery';
import { useUnits } from '../../prefs/useUnits';
import { unitScope } from '../../prefs/units';
import { ToolBtn } from '../common/ToolBtn';
import type { ConfigsTab } from '../../state/tabs';
import { ToggleButton } from '../common/ToggleButton';

/**
 * The Configurations tab: a toolbar, a sub-tab per part of a configuration, the
 * table of them, and, below lg, the selected one's editor underneath it.
 *
 * At lg+ the editor is the tab's right column (see App.tsx), so the table gets
 * the full width. One instance either way, never two with one hidden.
 */
export function ConfigsPane() {
  const { t } = useTranslation();
  const u = useUnits();
  const desktop = useIsDesktop();
  const configs = useWorkspaceStore((s) => s.configs);
  const sims = useWorkspaceStore((s) => s.sims);
  const tree = useWorkspaceStore((s) => s.tree);
  const sub = useWorkspaceStore((s) => s.configsTab);
  const setSub = useWorkspaceStore((s) => s.setConfigsTab);
  const selected = useWorkspaceStore(selectEditedConfig);
  const onSelect = useWorkspaceStore((s) => s.setSelectedConfigId);
  const addConfig = useWorkspaceStore((s) => s.addConfig);
  const copyConfig = useWorkspaceStore((s) => s.copyConfig);
  const deleteConfig = useWorkspaceStore((s) => s.deleteConfig);

  const columns = useMemo(() => {
    if (sub === 'motors') return motorColumns(tree, t);
    if (sub === 'recovery') {
      return recoveryColumns(tree, t, (device) => u.at(unitScope('prop', device.type, 'deployAltitude'), 'distance'));
    }
    return separationColumns(tree, t, (stage) => u.at(unitScope('prop', stage.type, 'separationAltitude'), 'distance'));
  }, [sub, tree, t, u]);

  const hint = { motors: 'configs.hint', recovery: 'configs.recoveryHint', separation: 'configs.separationHint' }[sub];

  // How many simulations fly each configuration. Counted once for the whole
  // table rather than per row, and it is also what decides whether deleting one
  // has to ask first.
  const flights = useMemo(() => {
    const out: Record<string, number> = {};
    for (const s of sims) out[s.configId] = (out[s.configId] ?? 0) + 1;
    return out;
  }, [sims]);

  const onDelete = async () => {
    // Asked only when a deletion actually moves something: a configuration
    // nothing flies is a row the user can put back with one click, and a prompt
    // for it is a prompt people learn to dismiss without reading.
    if ((flights[selected.id] ?? 0) === 0 || (await confirm({ message: t('configs.deleteConfirm'), danger: true }))) {
      deleteConfig(selected.id);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line/10 p-3">
        <ToolBtn onClick={addConfig}>{t('configs.new')}</ToolBtn>
        <ToolBtn onClick={() => copyConfig(selected.id)}>{t('configs.copy')}</ToolBtn>
        <ToolBtn
          onClick={() => void onDelete()}
          disabled={configs.length <= 1}
          title={configs.length <= 1 ? t('configs.deleteLast') : t('configs.delete')}
          danger
        >
          {t('configs.delete')}
        </ToolBtn>
        <nav aria-label={t('configs.title')} className="ml-auto flex items-center gap-1">
          <SubTab current={sub} value="motors" onClick={setSub}>
            {t('configs.motors')}
          </SubTab>
          <SubTab current={sub} value="recovery" onClick={setSub}>
            {t('configs.recovery')}
          </SubTab>
          <SubTab current={sub} value="separation" onClick={setSub}>
            {t('configs.separation')}
          </SubTab>
        </nav>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <p className="px-3 py-2 text-[11px] leading-snug text-ink-faint">{t(hint)}</p>
        <ConfigsTable
          configs={configs}
          tree={tree}
          columns={columns}
          selectedId={selected.id}
          flights={flights}
          onSelect={onSelect}
        />
        {/* Below lg there is no right column, so the editor goes here - which is
            the only way a phone can change a motor at all. */}
        {!desktop && (
          <div className="border-t border-line/10">
            <ConfigEditor />
          </div>
        )}
      </div>
    </div>
  );
}

function SubTab({
  current,
  value,
  onClick,
  children,
}: {
  current: ConfigsTab;
  value: ConfigsTab;
  onClick: (v: ConfigsTab) => void;
  children: React.ReactNode;
}) {
  return (
    <ToggleButton
      current
      active={current === value}
      onClick={() => onClick(value)}
      className="rounded-lg px-3 py-1.5 text-xs font-medium"
    >
      {children}
    </ToggleButton>
  );
}
