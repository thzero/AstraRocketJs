import { useTranslation } from 'react-i18next';
import { MaterialPicker } from '../design/MaterialPicker';
import { defaultMaterialKey } from '../../services/materials';
import type { MaterialType } from '../../services/materialTypes';
import type { Settings } from '../../services/settings';

/**
 * Settings ▸ Materials: what a NEWLY ADDED part is made of.
 *
 * The preference is spent at creation — the new part carries the material
 * outright, shows it in the panel and writes it to the `.ork`. Desktop
 * OpenRocket keeps the part unset and applies its equivalent preference when it
 * computes mass, which means the same file weighs one thing on the machine that
 * made it and another on the machine it was sent to. Existing parts are never
 * touched by a change here; it only applies from the next part you add.
 *
 * One row per material SLOT rather than per part, because a part can have more
 * than one: a parachute has a canopy and its shroud lines, and they are
 * different kinds of material measured in different units.
 */

/** Every slot a default can be set for, in the order the editor lists parts. */
const SLOTS: { part: string; material: MaterialType }[] = [
  { part: 'nosecone', material: 'bulk' },
  { part: 'bodytube', material: 'bulk' },
  { part: 'transition', material: 'bulk' },
  { part: 'trapezoidfinset', material: 'bulk' },
  { part: 'ellipticalfinset', material: 'bulk' },
  { part: 'freeformfinset', material: 'bulk' },
  { part: 'tubefinset', material: 'bulk' },
  { part: 'innertube', material: 'bulk' },
  { part: 'tubecoupler', material: 'bulk' },
  { part: 'centeringring', material: 'bulk' },
  { part: 'bulkhead', material: 'bulk' },
  { part: 'engineblock', material: 'bulk' },
  { part: 'launchlug', material: 'bulk' },
  { part: 'railbutton', material: 'bulk' },
  { part: 'parachute', material: 'surface' },
  { part: 'parachute', material: 'line' },
  { part: 'streamer', material: 'surface' },
  { part: 'shockcord', material: 'line' },
];

export function DefaultMaterials({
  defaults,
  onChange,
}: {
  defaults: Settings['defaultMaterials'];
  onChange: (next: Settings['defaultMaterials']) => void;
}) {
  const { t } = useTranslation();

  const set = (key: string, name: string | undefined, density: number) => {
    const next = { ...defaults };
    // Choosing "Automatic" clears the preference rather than storing a blank
    // one, so the setting only ever holds real choices.
    if (!name || !(density > 0)) delete next[key];
    else next[key] = { name, density };
    onChange(next);
  };

  return (
    <div className="space-y-3">
      <p className="text-[11px] leading-snug text-slate-500">{t('settings.materialsNote')}</p>
      {SLOTS.map(({ part, material }) => {
        const key = defaultMaterialKey(part, material);
        return (
          <MaterialPicker
            key={key}
            type={material}
            label={t(`settings.materialSlot.${material === 'bulk' ? part : `${part}_${material}`}`, {
              defaultValue: t(`part.${part}`, { defaultValue: part }),
            })}
            unsetLabel={t('settings.materialNoDefault')}
            value={defaults[key]?.name}
            onChange={(name, density) => set(key, name, density)}
          />
        );
      })}
    </div>
  );
}
