import { useEffect, useMemo, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { materialsForType, addCustom, removeCustom, groupsOf, DEFAULT_CUSTOM_GROUP } from '../../services/materials';
import { ADHESIVE_GROUP, type Material, type MaterialType } from '../../services/materialTypes';
import { UnitChip } from '../common/UnitChip';
import { NumberInput } from '../common/NumberInput';
import { useUnits } from '../../prefs/useUnits';
import { unitScope, type Quantity } from '../../prefs/units';

/**
 * Each material kind measures a different density, so each has its own
 * preference group: bulk stock by volume, fabric by area, cord by length.
 * The catalog and the engine hold all three in SI (kg/m³, kg/m², kg/m).
 */
const QUANTITY: Record<MaterialType, Quantity> = {
  bulk: 'density',
  surface: 'surfaceDensity',
  line: 'lineDensity',
};

/**
 * Assigns a material (name + density) to a component, from the built-in
 * catalog plus the user's custom materials (swappable MaterialStore). `type`
 * picks the catalog (bulk / surface / line); `label` names the row. Emits
 * `onChange(name, density, group)`; density 0 / name undefined means the
 * engine default.
 *
 * The group rides along because the picker is the only place that knows it:
 * the catalog is fetched, so a caller cannot look a name up synchronously in
 * its own handler, and a custom material is not in the catalog at all. The
 * `.ork` writer wants it, to file the material under its own category.
 */
/**
 * What the material is FOR, which decides whether the adhesives belong in the
 * list. Nothing else is filtered: every other bulk material in the table is
 * something a part can legitimately be made of, and guessing which ones suit
 * which component would block real builds (an aluminum fin, a printed nose
 * cone) to save a little scrolling.
 */
export type MaterialUse = 'structure' | 'fillet';

export function MaterialPicker({
  value,
  onChange,
  type = 'bulk',
  label,
  use = 'structure',
  unsetLabel,
}: {
  value?: string;
  onChange: (name: string | undefined, density: number, group?: string) => void;
  type?: MaterialType;
  label?: string;
  use?: MaterialUse;
  /**
   * What the "no material chosen" option is called. It means two different
   * things depending on where the picker is, so it cannot be one string: on a
   * PART it means the part is weighed with the built-in density, and in
   * Settings ▸ Materials it means new parts of that type get no material at
   * all. Defaults to the part wording.
   */
  unsetLabel?: string;
}) {
  const { t } = useTranslation();
  // Empty until the catalog arrives. It is a runtime file (public/data), the
  // same as the motor and component catalogs, so there is nothing to seed a
  // first paint with; the effect below fetches it and merges the user's custom
  // materials on top. The select renders its "no material" option meanwhile,
  // which is what a part with no material would show anyway.
  const [mats, setMats] = useState<Material[]>([]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  // Which group the new material joins. Custom materials used to be filed in a
  // `Custom` group of their own, which put every one of them at the top of the
  // list and away from the material it is usually a variant of.
  const [group, setGroup] = useState(DEFAULT_CUSTOM_GROUP);
  // In the field's unit; converted to SI on save. null while empty.
  const [dens, setDens] = useState<number | null>(null);
  const [addErr, setAddErr] = useState<string | null>(null);
  // Deleting can fail too, now that the material store reports a refused write
  // instead of swallowing it. `addErr` renders only inside the add form, so a
  // delete needs its own line or the failure would be invisible.
  const [delErr, setDelErr] = useState<string | null>(null);
  // Set when the catalog could not be fetched. Distinct from "no materials":
  // the list is empty either way, and only one of them is the app's fault.
  const [loadErr, setLoadErr] = useState<string | null>(null);
  // Both store round-trips below finish after an await, and selecting a
  // different component unmounts this picker in between - the effect above
  // already guards its own load with a `live` flag; these two did not.
  //
  // Re-armed in the effect body, not only cleared in its cleanup: the app
  // mounts under React.StrictMode, whose development double-invoke runs the
  // cleanup once and then the effect again. A cleanup-only guard was false for
  // the picker's whole life, so a custom material was saved and never applied.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const u = useUnits();
  const quantity = QUANTITY[type];
  // One scope per material kind — fabric and cord densities are read in quite
  // different units from bulk stock, so they must not share a choice.
  const scope = unitScope('material', type);
  const fu = u.at(scope, quantity);
  // No fixed decimal count: one that suits kg/m³ (680) is wrong for g/cm³
  // (0.68), and the unit can change under this readout at any time.
  const density = (si: number) => fu.fmt(si);

  useEffect(() => {
    let live = true;
    materialsForType(type)
      .then((m) => {
        if (live) {
          setMats(m);
          setLoadErr(null);
        }
      })
      .catch(() => {
        // The catalog is a download now, so it can fail: offline, or a data
        // host that is there but wrong. Say so instead of rendering an empty
        // list, which is indistinguishable from "this app has no materials".
        if (live) setLoadErr(t('material.loadFailed'));
      });
    return () => {
      live = false;
    };
  }, [type, t]);

  // Resolved against the WHOLE list, never the filtered one: a design can
  // already name a material this picker would not offer (a `.ork` with an
  // epoxy body tube), and the row has to keep showing what the part is made of.
  const current = mats.find((m) => m.name === value);

  /**
   * The list is the materials for THIS use, and nothing else.
   *
   * A structural part drops the adhesives: nothing is built out of glue, and
   * they were 13 rows of it under every body tube and centering ring. A fillet
   * drops everything that is not an adhesive, for the mirror of that reason.
   *
   * Filtering the fillet rather than merely ordering it is deliberate, and it
   * does not cost anyone a bead of something unusual: a thickened mix or a
   * putty is a custom material, and the add form asks which group it belongs
   * in, so filing it under Adhesives puts it here.
   *
   * Whatever the part ALREADY uses stays in the list either way. Dropping it
   * would leave the select showing no option for the value it holds, which
   * reads as "no material" on a part that has one.
   */
  const visible = useMemo(() => {
    const isAdhesive = (m: Material) => m.group === ADHESIVE_GROUP;
    const wanted = use === 'fillet' ? isAdhesive : (m: Material) => !isAdhesive(m);
    return mats.filter((m) => wanted(m) || m.name === current?.name);
  }, [mats, use, current?.name]);

  const groups = useMemo(() => {
    const g = new Map<string, Material[]>();
    for (const m of visible) {
      if (!g.has(m.group)) g.set(m.group, []);
      g.get(m.group)!.push(m);
    }
    return [...g.entries()];
  }, [visible]);

  const handleSelect = (v: string) => {
    if (v === '__default__') return onChange(undefined, 0);
    if (v === '__add__') return setAdding(true);
    const m = mats.find((x) => x.name === v);
    if (m) onChange(m.name, m.density, m.group);
  };

  const submitCustom = async () => {
    try {
      const next = await addCustom(name, type, dens == null ? NaN : fu.fromUi(dens), group);
      const list = await materialsForType(type);
      if (!mounted.current) return; // see deleteCurrentCustom
      setMats(list);
      const added = next[0];
      if (added) onChange(added.name, added.density, added.group);
      setAdding(false);
      setName('');
      setDens(null);
      setGroup(DEFAULT_CUSTOM_GROUP);
      setAddErr(null);
    } catch (e) {
      setAddErr(e instanceof Error ? e.message : String(e));
    }
  };

  const deleteCurrentCustom = async () => {
    if (!current?.custom) return;
    try {
      await removeCustom(current.name, type);
    } catch (e) {
      // The store's own message: a refused write is not always "storage
      // full", and saying so for every failure sent people deleting designs
      // to make room that was never short.
      setDelErr(e instanceof Error ? e.message : String(e));
      return; // the material is still there; do not tell the user otherwise
    }
    setDelErr(null);
    const next = await materialsForType(type);
    if (!mounted.current) return; // selecting another component unmounts this
    setMats(next);
    onChange(undefined, 0);
  };

  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="text-slate-300">{label ?? t('material.title')}</span>
        <span className="tabular-nums text-xs text-slate-400">
          {current ? (
            <>
              {density(current.density)} <UnitChip quantity={quantity} scope={scope} />
            </>
          ) : (
            t('material.default')
          )}
          {current?.custom && (
            <button onClick={deleteCurrentCustom} className="ml-2 text-red-400" aria-label={t('material.deleteCustom')}>
              ✕
            </button>
          )}
        </span>
      </div>
      <select
        value={current ? current.name : loadErr && value ? value : '__default__'}
        onChange={(e) => handleSelect(e.target.value)}
        className="w-full rounded-lg bg-slate-950 px-2 py-2 text-sm text-slate-100 ring-1 ring-white/10"
      >
        <option value="__default__">{unsetLabel ?? t('material.defaultOption')}</option>
        {/* The part's own material, when the catalog did not arrive to confirm
            it. Without this the select falls back to "no material", so the row
            would describe a part that has one as a part that does not. Its
            density is in the tree, not here, so the name is all this shows. */}
        {loadErr && value && !current && <option value={value}>{value}</option>}
        {groups.map(([g, list]) => (
          <optgroup key={g} label={g}>
            {list.map((m) => (
              <option key={`${g}:${m.name}`} value={m.name}>
                {m.custom ? '★ ' : ''}
                {m.name} · {density(m.density)} {fu.sym}
              </option>
            ))}
          </optgroup>
        ))}
        <option value="__add__">{t('material.addCustom')}</option>
      </select>

      {!current && !loadErr && (
        <p className="mt-1 text-[11px] leading-snug text-slate-500">{t('material.defaultHint')}</p>
      )}
      {loadErr && <p className="mt-1 text-xs text-red-400">{loadErr}</p>}
      {delErr && <p className="mt-1 text-xs text-red-400">{delErr}</p>}

      {adding && (
        <div className="mt-2 space-y-2 rounded-lg bg-slate-950 p-2 ring-1 ring-white/10">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('material.namePlaceholder')}
            className="w-full rounded bg-slate-900 px-2 py-1.5 text-sm ring-1 ring-white/10 placeholder:text-slate-500"
          />
          <label className="flex items-center justify-between gap-2 text-xs text-slate-400">
            {t('material.group')}
            <select
              value={group}
              onChange={(e) => setGroup(e.target.value)}
              className="w-40 rounded bg-slate-900 px-2 py-1.5 text-sm text-slate-100 ring-1 ring-white/10"
            >
              {groupsOf(mats).map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </label>
          {/* NumberInput, not a raw <input> + parseFloat: the same draft
              handling every other numeric field has, and the value arrives
              as a number in the field's unit. */}
          <NumberInput
            value={dens}
            onChange={setDens}
            min={0}
            step={fu.step(10)}
            placeholder={`${t('material.densityPlaceholder')} (${fu.sym})`}
            ariaLabel={`${t('material.densityPlaceholder')} (${fu.sym})`}
            className="w-full rounded bg-slate-900 px-2 py-1.5 text-sm tabular-nums ring-1 ring-white/10 placeholder:text-slate-500"
          />
          {addErr && <p className="text-xs text-red-400">{addErr}</p>}
          <div className="flex gap-2">
            <button onClick={submitCustom} className="flex-1 rounded bg-sky-600 py-1.5 text-sm font-medium text-white">
              {t('material.save')}
            </button>
            <button
              onClick={() => {
                setAdding(false);
                setAddErr(null);
              }}
              className="flex-1 rounded bg-slate-800 py-1.5 text-sm text-slate-300"
            >
              {t('material.cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
