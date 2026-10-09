import { useTranslation } from 'react-i18next';
import type { ComponentNode, RocketTree } from '../../engine/openRocketEngine';
import { loadoutLabel, type FlightConfig } from '../../services/flight/flightConfigs';

/** One column of the table: a part of the rocket, and what each setup does with it. */
export interface ConfigColumn {
  id: string;
  label: string;
  cell: (config: FlightConfig) => React.ReactNode;
}

/**
 * The configurations table: one row per flight configuration, one column per
 * part it configures, the way the desktop's flight-configuration panel lays it
 * out.
 *
 * Reading across a row tells you what that setup does everywhere; reading down a
 * column tells you what the same mount or chute does under each setup, which is
 * the comparison a staged rocket is designed around and the one a list of names
 * cannot show. The sub-tab decides what the columns are (motors, recovery).
 *
 * Selecting a row is all this does. Values are changed in the editor beside it,
 * so there is one place a configuration is written and the table stays a view.
 *
 * Narrow screens keep the name and the flight count and drop the part columns,
 * because the editor underneath shows the same values with room to change them.
 */
export function ConfigsTable({
  configs,
  tree,
  columns,
  selectedId,
  flights,
  onSelect,
}: {
  configs: FlightConfig[];
  tree: RocketTree;
  columns: ConfigColumn[];
  selectedId: string;
  /** How many simulations fly each configuration, by configuration id. */
  flights: Record<string, number>;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <table aria-label={t('configs.title')} className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-line/10 text-[11px] uppercase tracking-wide text-ink-muted">
          <th scope="col" className="px-2 py-2 text-left font-semibold">
            {t('configs.name')}
          </th>
          {columns.map((col) => (
            <th key={col.id} scope="col" className="hidden px-2 py-2 text-left font-semibold lg:table-cell">
              {col.label}
            </th>
          ))}
          <th scope="col" className="px-2 py-2 text-right font-semibold">
            {t('configs.flights')}
          </th>
        </tr>
      </thead>
      <tbody>
        {configs.map((c) => {
          const label = c.name || loadoutLabel(tree, c);
          return (
            <tr
              key={c.id}
              onClick={() => onSelect(c.id)}
              className={`cursor-pointer border-b border-line/5 ${
                c.id === selectedId ? 'bg-accent-950/40' : 'hover:bg-raised/50'
              }`}
            >
              <td className="px-2 py-2">
                {/* A button, not the row's click handler alone: the row is what
                    a pointer aims at, and this is what a keyboard reaches and a
                    screen reader announces. */}
                <button
                  onClick={() => onSelect(c.id)}
                  aria-current={c.id === selectedId ? 'true' : undefined}
                  className={`text-left ${c.id === selectedId ? 'font-semibold text-accent-300' : 'text-ink'}`}
                >
                  {label || <span className="text-ink-faint">{t('configs.noMotors')}</span>}
                </button>
              </td>
              {columns.map((col) => (
                <td key={col.id} className="hidden px-2 py-2 text-ink-muted lg:table-cell">
                  {col.cell(c)}
                </td>
              ))}
              <td className="px-2 py-2 text-right tabular-nums text-ink-muted">{flights[c.id] ?? 0}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** A part's own name, else its type and its place in tree order ("Inner tube 2"). */
export function partName(node: ComponentNode, i: number, t: (k: string) => string): string {
  return typeof node.name === 'string' && node.name ? node.name : `${t(`part.${node.type}`)} ${i + 1}`;
}
