// The volume a catalog part has when the app builds it, measured in the app's
// own engine.
//
// A part whose catalog row states a mass is given the density that spreads that
// mass over its volume, so it weighs what the catalog says. Which volume matters:
// the desktop computes it for the OpenRocket build that loads the database, and
// builds disagree. The engine here is newer than the 24.12 release, and since
// then `Transition.loadFromPreset` gives a preset's shoulders the part's wall
// (upstream 90a57aa33), so the same nose cone has more volume. A density taken
// from 24.12 and flown here weighs up to a third more than the catalog states.
// Measured in the engine the app flies, the part weighs its stated mass.
//
// The node built here has to be the node the app builds from the row
// (`catalogPatch` in src/services/design/treeEdit.ts). It cannot import that
// TypeScript, so it repeats the geometry it states; `catalogPatch.kernel.test.ts`
// applies every massed row through `catalogPatch` and requires the kernel mass to
// equal the stated one, which fails if the two drift apart.
// A URL rather than a path: a Windows drive letter is not an import scheme.
const ENGINE = new URL('../../src/engine/vendor/openrocket-engine.mjs', import.meta.url).href;

/** `SymmetricComponent.DEFAULT_THICKNESS`: a new part's wall (m). */
const DEFAULT_WALL = 0.002;

/** A shoulder as `Transition.loadFromPreset` applies it: solid when filled, else the stated wall. */
function shoulder(prefix, diameter, length, row) {
  if (diameter == null) return {};
  const key = (k) => (prefix ? `${prefix}${k}` : k.charAt(0).toLowerCase() + k.slice(1));
  const radius = diameter / 2;
  const wall = row.filled ? radius : row.thickness;
  return {
    [key('ShoulderRadius')]: radius,
    ...(length == null ? {} : { [key('ShoulderLength')]: length }),
    ...(wall == null ? {} : { [key('ShoulderThickness')]: wall }),
  };
}

/** The part's node at density 1, so the mass the engine reports is its volume. */
function partNode(row) {
  const unit = { id: 'probe', density: 1, materialName: 'unit' };
  const tubeWall = (r) =>
    r.innerDiameter ? { thickness: Math.max(0.0001, (r.outerDiameter - r.innerDiameter) / 2) } : {};
  switch (row.type) {
    case 'nosecone': {
      const radius = row.outerDiameter / 2;
      return {
        ...unit,
        type: 'nosecone',
        shape: row.shape,
        length: row.length,
        aftRadius: radius,
        filled: !!row.filled,
        thickness: row.filled ? radius : (row.thickness ?? DEFAULT_WALL),
        ...shoulder('', row.shoulderDiameter, row.shoulderLength, row),
      };
    }
    case 'transition':
      return {
        ...unit,
        type: 'transition',
        shape: row.shape,
        length: row.length,
        foreRadius: row.foreOuterDiameter / 2,
        aftRadius: row.aftOuterDiameter / 2,
        filled: !!row.filled,
        ...(row.thickness != null && !row.filled ? { thickness: row.thickness } : {}),
        ...shoulder('fore', row.foreShoulderDiameter, row.foreShoulderLength, row),
        ...shoulder('aft', row.aftShoulderDiameter, row.aftShoulderLength, row),
      };
    case 'bodytube':
    case 'tubecoupler':
    case 'engineblock':
    case 'launchlug':
      return { ...unit, type: row.type, outerRadius: row.outerDiameter / 2, length: row.length, ...tubeWall(row) };
    case 'centeringring':
      return {
        ...unit,
        type: 'centeringring',
        outerRadius: row.outerDiameter / 2,
        innerRadius: (row.innerDiameter ?? 0) / 2,
        length: row.length,
      };
    case 'bulkhead':
      return { ...unit, type: 'bulkhead', outerRadius: row.outerDiameter / 2, length: row.length };
    default:
      return null;
  }
}

/** A design holding the part where it can sit: airframe parts in the stage, the rest inside a tube. */
function design(probe) {
  const tube = (children = []) => ({
    type: 'bodytube',
    id: 'host',
    length: 1,
    outerRadius: 0.2,
    thickness: 0.001,
    children,
  });
  const chain =
    probe.type === 'nosecone' || probe.type === 'bodytube'
      ? [probe]
      : probe.type === 'transition'
        ? [tube(), probe]
        : probe.type === 'engineblock'
          ? [
              tube([
                { type: 'innertube', id: 'mmt', length: 0.2, outerRadius: 0.1, thickness: 0.001, children: [probe] },
              ]),
            ]
          : [tube([probe])];
  return { components: [{ type: 'stage', id: 'st', children: chain }] };
}

/**
 * A function from a catalog row to its volume (m³) as the engine builds it, or
 * null for a part it does not size this way.
 */
export async function presetVolumes() {
  globalThis.$rt_putStdoutCustom ??= () => {};
  globalThis.$rt_putStderrCustom ??= () => {};
  const engine = await import(ENGINE);
  return (row) => {
    const probe = partNode(row);
    if (!probe) return null;
    engine.reset();
    const handle = engine.buildRocket(JSON.stringify(design(probe)));
    const info = JSON.parse(engine.getComponentInfo(handle, 'probe'));
    return Number.isFinite(info.mass) && info.mass > 0 ? info.mass : null;
  };
}
