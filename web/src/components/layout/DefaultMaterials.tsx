import { useTranslation } from 'react-i18next';
import { MaterialPicker } from '../design/MaterialPicker';
import { MATERIAL_SLOTS, defaultMaterialKey } from '../../services/design/materialSlots';
import type { Settings } from '../../services/storage/settings';

/**
 * Settings ▸ Materials: what a newly added part is made of.
 *
 * The preference is spent at creation: the new part carries the material
 * outright, shows it in the panel and writes it to the `.ork`. Desktop
 * OpenRocket does the same: each component's constructor takes its material
 * from the equivalent preference (ExternalComponent, StructuralComponent,
 * RecoveryDevice, ShockCord). With no default set here, the part gets the
 * kernel's stock material. Existing parts are never touched by a change here;
 * it only applies from the next part you add.
 *
 * One row per material slot rather than per part, because a part can have more
 * than one: a parachute has a canopy and its shroud lines, and they are
 * different kinds of material measured in different units.
 */

export function DefaultMaterials({
  defaults,
  onChange,
}: {
  defaults: Settings['defaultMaterials'];
  onChange: (next: Settings['defaultMaterials']) => void;
}) {
  const { t } = useTranslation();

  const set = (key: string, name: string | undefined, density: number, group?: string) => {
    const next = { ...defaults };
    // Choosing "No default" clears the preference rather than storing a blank
    // one, so the setting only ever holds real choices. The catalog group goes
    // with it, as it does with a material picked in the property panel, so a
    // new part's material is filed under its own category in the `.ork`.
    if (!name || !(density > 0)) delete next[key];
    else next[key] = group ? { name, density, group } : { name, density };
    onChange(next);
  };

  return (
    <div className="space-y-3">
      <p className="text-[11px] leading-snug text-ink-faint">{t('settings.materialsNote')}</p>
      {MATERIAL_SLOTS.map(({ part, material }) => {
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
            density={defaults[key]?.density}
            onChange={(name, density, group) => set(key, name, density, group)}
          />
        );
      })}
    </div>
  );
}
