import type { Tab } from '../../state/tabs';

interface TabEntry {
  id: Tab;
  /** The desktop strip's label key. */
  label: string;
  /** The phone bar's label key: five buttons share a phone's width. */
  short: string;
  icon: string;
}

/**
 * The workbench tabs after Design, in order, for both the desktop strip
 * (WorkbenchTabs) and the phone bar (TabBar). Design leads both and is not
 * listed: the phone splits it into two buttons, one per half. Results shows
 * only while useShowResultsTab says so.
 */
const TASK_TABS: readonly TabEntry[] = [
  { id: 'configs', label: 'tabs.configs', short: 'tabs.configsShort', icon: '🔥' },
  { id: 'sim', label: 'tabs.simulations', short: 'tabs.simulate', icon: '📈' },
  { id: 'results', label: 'tabs.results', short: 'tabs.results', icon: '📊' },
  { id: 'tools', label: 'tabs.tools', short: 'tabs.tools', icon: '🧰' },
];

/** The tabs after Design that are on show, given whether Results is. */
export const taskTabs = (showResults: boolean): readonly TabEntry[] =>
  showResults ? TASK_TABS : TASK_TABS.filter((e) => e.id !== 'results');
