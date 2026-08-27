import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { builtinsForType, materialsForType, addCustom, removeCustom } from '../../services/materials';
import type { Material } from '../../data/materials';
import { fmtNum } from '../../i18n/format';

/**
 * Assigns a bulk material (name + density) to a component, from the built-in
 * catalogue plus the user's custom materials (swappable MaterialStore). Emits
 * `onChange(name, density)`; density 0 / name undefined means the engine default.
 */
export function MaterialPicker({ value, onChange }: {
  value?: string; onChange: (name: string | undefined, density: number) => void;
}) {
  const { t } = useTranslation();
  // Seed with built-ins for the first paint; the store (async, swappable) then
  // merges in the user's custom materials.
  const [mats, setMats] = useState<Material[]>(() => builtinsForType('bulk'));
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [dens, setDens] = useState('');
  const [addErr, setAddErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    materialsForType('bulk').then((m) => { if (live) setMats(m); });
    return () => { live = false; };
  }, []);

  const groups = useMemo(() => {
    const g = new Map<string, Material[]>();
    for (const m of mats) {
      if (!g.has(m.group)) g.set(m.group, []);
      g.get(m.group)!.push(m);
    }
    return [...g.entries()];
  }, [mats]);

  const current = mats.find((m) => m.name === value);

  const handleSelect = (v: string) => {
    if (v === '__default__') return onChange(undefined, 0);
    if (v === '__add__') return setAdding(true);
    const m = mats.find((x) => x.name === v);
    if (m) onChange(m.name, m.density);
  };

  const submitCustom = async () => {
    try {
      const next = await addCustom(name, 'bulk', parseFloat(dens));
      setMats(await materialsForType('bulk'));
      onChange(next[0].name, next[0].density);
      setAdding(false); setName(''); setDens(''); setAddErr(null);
    } catch (e) {
      setAddErr(e instanceof Error ? e.message : String(e));
    }
  };

  const deleteCurrentCustom = async () => {
    if (!current?.custom) return;
    await removeCustom(current.name, 'bulk');
    setMats(await materialsForType('bulk'));
    onChange(undefined, 0);
  };

  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="text-slate-300">{t('material.title')}</span>
        <span className="tabular-nums text-xs text-slate-400">
          {current ? `${fmtNum(current.density, 0)} kg/m³` : t('material.default')}
          {current?.custom && (
            <button onClick={deleteCurrentCustom} className="ml-2 text-red-400" aria-label={t('material.deleteCustom')}>✕</button>
          )}
        </span>
      </div>
      <select
        value={current ? current.name : '__default__'}
        onChange={(e) => handleSelect(e.target.value)}
        className="w-full rounded-lg bg-slate-950 px-2 py-2 text-sm text-slate-100 ring-1 ring-white/10"
      >
        <option value="__default__">{t('material.defaultOption')}</option>
        {groups.map(([g, list]) => (
          <optgroup key={g} label={g}>
            {list.map((m) => (
              <option key={`${g}:${m.name}`} value={m.name}>
                {m.custom ? '★ ' : ''}{m.name} · {fmtNum(m.density, 0)} kg/m³
              </option>
            ))}
          </optgroup>
        ))}
        <option value="__add__">{t('material.addCustom')}</option>
      </select>

      {!current && <p className="mt-1 text-[11px] leading-snug text-slate-500">{t('material.defaultHint')}</p>}

      {adding && (
        <div className="mt-2 space-y-2 rounded-lg bg-slate-950 p-2 ring-1 ring-white/10">
          <input
            value={name} onChange={(e) => setName(e.target.value)} placeholder={t('material.namePlaceholder')}
            className="w-full rounded bg-slate-900 px-2 py-1.5 text-sm ring-1 ring-white/10 placeholder:text-slate-500"
          />
          <input
            value={dens} onChange={(e) => setDens(e.target.value)} type="number" min={0} step="any"
            placeholder={t('material.densityPlaceholder')}
            className="w-full rounded bg-slate-900 px-2 py-1.5 text-sm tabular-nums ring-1 ring-white/10 placeholder:text-slate-500"
          />
          {addErr && <p className="text-xs text-red-400">{addErr}</p>}
          <div className="flex gap-2">
            <button onClick={submitCustom} className="flex-1 rounded bg-sky-600 py-1.5 text-sm font-medium text-white">{t('material.save')}</button>
            <button onClick={() => { setAdding(false); setAddErr(null); }} className="flex-1 rounded bg-slate-800 py-1.5 text-sm text-slate-300">{t('material.cancel')}</button>
          </div>
        </div>
      )}
    </div>
  );
}
