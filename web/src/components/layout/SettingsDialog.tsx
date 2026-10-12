import { useState, type ReactNode } from 'react';
import { useTabs } from '../common/useTabs';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../../state/SettingsProvider';
import { DEFAULT_SETTINGS } from '../../services/storage/settings';
import { Dialog } from '../common/Dialog';
import { DialogButton } from '../common/DialogButton';
import { confirm } from '../../state/confirmStore';
import { fireAction } from '../../state/fireAction';
import type { SettingsTab } from './dialogKeys';
import {
  ColorsTab,
  GeneralTab,
  LaunchTab,
  MaterialsTab,
  PlaybackTab,
  SimTab,
  SketchTab,
  UnitsTab,
} from './SettingsTabs';

const TABS: { key: SettingsTab; label: string }[] = [
  { key: 'general', label: 'settings.tabGeneral' },
  { key: 'units', label: 'settings.tabUnits' },
  { key: 'colors', label: 'settings.tabColors' },
  { key: 'materials', label: 'settings.tabMaterials' },
  { key: 'playback', label: 'settings.tabPlayback' },
  { key: 'sketch', label: 'settings.tabSketch' },
  { key: 'sim', label: 'settings.tabSim' },
  { key: 'launch', label: 'settings.tabLaunch' },
];

/** Each tab's body, by key. */
const TAB_BODY: Record<SettingsTab, ReactNode> = {
  general: <GeneralTab />,
  units: <UnitsTab />,
  colors: <ColorsTab />,
  materials: <MaterialsTab />,
  playback: <PlaybackTab />,
  sketch: <SketchTab />,
  sim: <SimTab />,
  launch: <LaunchTab />,
};

/** Settings panel, one tab per entry in the list above (general, units,
 *  colors, materials, playback, sketch, simulation and launch defaults).
 *  Persisted via the SettingsProvider.
 *  Mounted only while open (`{open && <SettingsDialog />}`). */
export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { update, reset } = useSettings();
  const [tab, setTab] = useState<SettingsTab>('general');
  const tabs = useTabs(
    TABS.map((x) => x.key),
    tab,
    setTab,
  );
  // Every tab at once, and no undo: asked first.
  const resetAll = async () => {
    const ok = await confirm({
      message: t('settings.resetAllConfirm'),
      confirmLabel: t('settings.resetAll'),
      danger: true,
    });
    if (ok) reset();
  };

  const tabName = t(TABS.find((x) => x.key === tab)!.label);
  const resetSection = async () => {
    // The tabs that hold what the user entered rather than a preference picked
    // from a list: the home launch site, and the material chosen for each part
    // type. Neither has an undo, so a stray click is asked about first.
    if (tab === 'launch' || tab === 'materials') {
      const ok = await confirm({
        message: t('settings.resetTabConfirm', { name: tabName }),
        confirmLabel: t('settings.resetTab', { name: tabName }),
        danger: true,
      });
      if (!ok) return;
    }
    if (tab === 'general')
      update({
        saveDesignInfo: DEFAULT_SETTINGS.saveDesignInfo,
        askWhereToSave: DEFAULT_SETTINGS.askWhereToSave,
        theme: DEFAULT_SETTINGS.theme,
        themeBeforeDaylight: DEFAULT_SETTINGS.themeBeforeDaylight,
      });
    else if (tab === 'units') update({ units: DEFAULT_SETTINGS.units, unitOverrides: {} });
    else if (tab === 'colors') update({ partColors: {}, phaseColors: DEFAULT_SETTINGS.phaseColors });
    else if (tab === 'materials') update({ defaultMaterials: DEFAULT_SETTINGS.defaultMaterials });
    else if (tab === 'playback') update({ playbackSpeed: DEFAULT_SETTINGS.playbackSpeed });
    else if (tab === 'sketch') update({ showMarkers: DEFAULT_SETTINGS.showMarkers, rulers: DEFAULT_SETTINGS.rulers });
    else if (tab === 'sim') update({ simulation: DEFAULT_SETTINGS.simulation });
    else update({ launchDefaults: DEFAULT_SETTINGS.launchDefaults });
  };

  return (
    <Dialog
      id="settings"
      title={t('settings.title')}
      onClose={onClose}
      size="lg"
      // A fixed height, because eight tabs holding between two rows and thirty
      // would otherwise resize and re-center the dialog every time you moved
      // between them.
      height={560}
      toolbar={
        // Tabs. A real tablist, so which section is open is announced rather
        // than shown by background color alone. In the toolbar band so it stays
        // put while a long tab scrolls.
        <div role="tablist" aria-label={t('settings.title')} className="flex flex-wrap gap-1 p-3">
          {TABS.map((tb) => (
            <button
              key={tb.key}
              {...tabs.tab(tb.key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium ${tab === tb.key ? 'bg-accent-600 text-on-accent' : 'bg-raised text-ink-soft hover:bg-elevated'}`}
            >
              {t(tb.label)}
            </button>
          ))}
        </div>
      }
      footer={
        <div className="flex items-center justify-between gap-2 p-4">
          <div className="flex gap-2">
            <button
              onClick={() => fireAction(resetSection())}
              className="rounded-lg bg-raised px-3 py-2 text-xs font-medium text-ink-soft ring-1 ring-line/10 hover:bg-elevated"
            >
              {t('settings.resetTab', { name: tabName })}
            </button>
            <button
              onClick={() => fireAction(resetAll())}
              className="rounded-lg bg-raised px-3 py-2 text-xs font-medium text-ink-soft ring-1 ring-line/10 hover:bg-elevated"
            >
              {t('settings.resetAll')}
            </button>
          </div>
          <DialogButton onClick={onClose} variant="primary">
            {t('settings.close')}
          </DialogButton>
        </div>
      }
    >
      <div {...tabs.panel} className="space-y-2 p-4">
        {TAB_BODY[tab]}
      </div>
    </Dialog>
  );
}
