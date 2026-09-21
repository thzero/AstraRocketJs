import type * as THREE from 'three';
import { zipSync, strToU8 } from 'fflate';
import { escapeXml } from './xmlUtil';
import { M_TO_MM } from '../prefs/units';

/**
 * 3MF (3D Manufacturing Format) writer.
 *
 * WHY, beside the STL/OBJ/GLB the app already writes. STL is naked triangles:
 * no name, no color, no declared unit, one object per file. A rocket exported
 * part by part therefore arrives in the slicer as a pile of anonymous solids
 * you have to re-identify by eye. 3MF carries the part's NAME, a color, an
 * explicit unit and any number of objects in one file, and every current slicer
 * prefers it. That is the whole of the improvement, and it is most of the
 * reason to export a whole rocket at once rather than one part at a time.
 *
 * WHAT IT IS. A zip holding three members: the OPC content-type map, a
 * relationship pointing at the model, and the model itself — plain XML with a
 * vertex list and a triangle list per object, then a `<build>` naming which
 * objects to place and where. No compression tricks, no binary payload.
 *
 * ORIENTATION IS LEFT ALONE. Our solids are built with the rocket's axis along
 * X (`solidMesh.ts` lathes about Y and rotates into X), which for a tube or a
 * nose cone means lying on its side. Standing them up would be right for most
 * bodies and wrong for every fin and ring, and it would silently make the 3MF
 * geometry differ from the STL of the same part. `placeOnPlate` therefore only
 * TRANSLATES — the slicer's own lay-flat is the right tool for the rest, and it
 * is one click there.
 */

/** One object to write: a watertight solid, named, optionally colored. */
export interface ThreeMfPart {
  /** Shown as the object's name in the slicer's object list. */
  name: string;
  /** Watertight, INDEXED geometry in meters (see `makeWatertight`). */
  geometry: THREE.BufferGeometry;
  /** `#rrggbb`; falls back to the neutral the other mesh exports use. */
  color?: string;
}

export interface ThreeMfOptions {
  /**
   * Translate each object so its bounding box is centered on X/Y and its lowest
   * point sits at Z = 0 — "drop it on the bed". On by default, because a part
   * exported at its position in the rocket lands meters from the plate origin.
   */
  placeOnPlate?: boolean;
}

export const THREE_MF_MIME = 'model/3mf';

const NEUTRAL = '#cfcabf';

/** `#rgb` / `#rrggbb` → the `#RRGGBBAA` the spec's `displaycolor` wants. */
function displayColor(color: string | undefined): string {
  const hex = (color ?? NEUTRAL).trim();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(hex);
  const full = short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}` : hex;
  return /^#[0-9a-f]{6}$/i.test(full) ? `${full.toUpperCase()}FF` : `${NEUTRAL.toUpperCase()}FF`;
}

/** Six decimals is ~a nanometer at millimeter scale, and keeps the file small. */
const fmt = (v: number): string => {
  const r = Math.round(v * 1e6) / 1e6;
  return Object.is(r, -0) ? '0' : String(r);
};

/**
 * One object's `<mesh>`, plus the translation its build item needs.
 *
 * Meters in, MILLIMETERS out: 3MF states its unit, and every slicer and CAD
 * tool assumes mm, so a meter-scale model would import a thousand times too
 * small. Same `M_TO_MM` the STL/OBJ/GLB path scales by.
 */
function meshXml(part: ThreeMfPart, placeOnPlate: boolean): { xml: string; offset: [number, number, number] } {
  const pos = part.geometry.getAttribute('position');
  const idx = part.geometry.getIndex();
  if (!pos || !idx) throw new Error(`${part.name}: geometry is not indexed`);

  const verts: string[] = [];
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity,
    minZ = Infinity;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) * M_TO_MM,
      y = pos.getY(i) * M_TO_MM,
      z = pos.getZ(i) * M_TO_MM;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    verts.push(`<vertex x="${fmt(x)}" y="${fmt(y)}" z="${fmt(z)}"/>`);
  }

  const tris: string[] = [];
  for (let i = 0; i < idx.count; i += 3) {
    // Winding is carried through unchanged: `makeWatertight` already produces
    // outward-facing triangles (the STL written from the same geometry slices
    // correctly), and 3MF wants the same right-hand rule.
    tris.push(`<triangle v1="${idx.getX(i)}" v2="${idx.getX(i + 1)}" v3="${idx.getX(i + 2)}"/>`);
  }

  const offset: [number, number, number] = placeOnPlate ? [-(minX + maxX) / 2, -(minY + maxY) / 2, -minZ] : [0, 0, 0];

  return {
    xml: `<mesh><vertices>${verts.join('')}</vertices><triangles>${tris.join('')}</triangles></mesh>`,
    offset,
  };
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>
`;

const RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>
`;

/** The model XML for a set of parts (exported for testing; the zip is the product). */
export function threeMfModelXml(parts: ThreeMfPart[], opts: ThreeMfOptions = {}): string {
  const placeOnPlate = opts.placeOnPlate ?? true;

  // Resource ids are 1-based and must be unique. The base-materials group takes
  // 1, so object n is id n+1 and `pindex` n indexes its own material.
  const bases = parts.map(
    (p) => `<base name="${escapeXml(p.name || 'Part')}" displaycolor="${displayColor(p.color)}"/>`,
  );

  const objects: string[] = [];
  const items: string[] = [];
  parts.forEach((part, i) => {
    const { xml, offset } = meshXml(part, placeOnPlate);
    const id = i + 2;
    objects.push(
      `<object id="${id}" type="model" pid="1" pindex="${i}" name="${escapeXml(part.name || 'Part')}">${xml}</object>`,
    );
    // Row-major 4x3: the identity basis, then the translation. 3MF omits the
    // fourth column, which is always (0,0,0,1).
    const [tx, ty, tz] = offset;
    items.push(`<item objectid="${id}" transform="1 0 0 0 1 0 0 0 1 ${fmt(tx)} ${fmt(ty)} ${fmt(tz)}"/>`);
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>
    <basematerials id="1">${bases.join('')}</basematerials>
    ${objects.join('\n    ')}
  </resources>
  <build>
    ${items.join('\n    ')}
  </build>
</model>
`;
}

/** A complete `.3mf` archive holding every part as its own named object. */
export function buildThreeMf(parts: ThreeMfPart[], opts: ThreeMfOptions = {}): Uint8Array {
  if (parts.length === 0) throw new Error('Nothing to export.');
  return zipSync(
    {
      '[Content_Types].xml': strToU8(CONTENT_TYPES),
      '_rels/.rels': strToU8(RELS),
      '3D/3dmodel.model': strToU8(threeMfModelXml(parts, opts)),
    },
    { level: 6 },
  );
}
