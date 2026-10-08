import * as THREE from 'three';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { makeWatertight } from './solidMesh';

/**
 * 3D mesh export (STL / OBJ / glTF-binary) of a single component's solid.
 *
 * The geometry is a purpose-built watertight solid (see {@link makeWatertight}
 * and solidForNode), scaled from meters to millimeters, the unit every slicer
 * and CAD tool assumes (a meter-scale part would import 1000x too small). STL is
 * geometry only; OBJ and GLB also carry a neutral material.
 */

export const STL_MIME = 'model/stl';
export const OBJ_MIME = 'model/obj';
export const GLB_MIME = 'model/gltf-binary';

// Meters -> millimeters, the scale every slicer/CAD importer expects. Shared
// with every other dimensional export rather than redeclared here.
import { M_TO_MM } from '../../prefs/units';
import { UNKNOWN_PART_COLOR } from '../design/partColors';
import { errorMessage } from '../app/errorMessage';

/** A watertight, millimeter-scaled mesh of one solid, ready for an exporter. */
function meshGroup(geometry: THREE.BufferGeometry): THREE.Group {
  const group = new THREE.Group();
  group.add(new THREE.Mesh(makeWatertight(geometry), new THREE.MeshStandardMaterial({ color: UNKNOWN_PART_COLOR })));
  group.scale.setScalar(M_TO_MM);
  group.updateMatrixWorld(true); // exporters read matrixWorld
  return group;
}

/** Binary STL bytes for one solid. */
export function solidToStl(geometry: THREE.BufferGeometry): ArrayBuffer {
  const dv = new STLExporter().parse(meshGroup(geometry), { binary: true }) as unknown as DataView;
  return dv.buffer.slice(dv.byteOffset, dv.byteOffset + dv.byteLength) as ArrayBuffer;
}

/** Wavefront OBJ text for one solid. */
export function solidToObj(geometry: THREE.BufferGeometry): string {
  return new OBJExporter().parse(meshGroup(geometry));
}

/** glTF-binary (.glb) bytes for one solid. */
export function solidToGlb(geometry: THREE.BufferGeometry): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    new GLTFExporter().parse(
      meshGroup(geometry),
      (result) => resolve(result as ArrayBuffer),
      (err) => reject(err instanceof Error ? err : new Error(errorMessage(err))),
      { binary: true },
    );
  });
}
