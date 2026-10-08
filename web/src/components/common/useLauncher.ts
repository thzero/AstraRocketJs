import { useTranslation } from 'react-i18next';
import { useWorkspaceStore } from '../../state/store';
import { launcherKind, withLauncher, type LauncherKind } from '../../services/design/launcher';

/** What the design on screen is launched from; see services/design/launcher. */
export function useLauncherKind(): LauncherKind | null {
  return useWorkspaceStore((s) => launcherKind(s.tree));
}

/** `t`, naming the launcher the way the design on screen does. */
export function useLauncherT() {
  const { t } = useTranslation();
  const kind = useLauncherKind();
  return withLauncher(t as unknown as (key: string, options?: Record<string, unknown>) => string, kind);
}
