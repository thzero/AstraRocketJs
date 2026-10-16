import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkspaceStore } from '../../state/store';
import { useUnits } from '../../prefs/useUnits';
import { APP_VERSION, designNameOf } from '../../services/app/appInfo';

/**
 * The header block the 2D/3D image exports stamp on the page: name, the
 * static numbers, the user's units, the app version, worded in the UI language.
 *
 * `TreeSchematic` and `Rocket3D` show their export buttons only when given
 * `exportData`, so without this hook neither view offers an export.
 */
export function useExportData(motors: object) {
  const loadedMeta = useWorkspaceStore((s) => s.loadedMeta);
  const treeName = useWorkspaceStore((s) => s.tree.name);
  const info = useWorkspaceStore((s) => s.info);
  const units = useUnits();
  const { t } = useTranslation();
  return useMemo(
    () => ({
      name: designNameOf({ name: treeName }, loadedMeta),
      info,
      units: units.all,
      withMotors: Object.keys(motors).length > 0,
      appVersion: APP_VERSION,
      t,
    }),
    [loadedMeta, treeName, info, units.all, motors, t],
  );
}
