import * as THREE from 'three';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { makeWatertight } from './solidMesh';
import { saveBlob } from './saveFile';

/**
 * 3D mesh export (STL / OBJ / glTF-binary) of a SINGLE component's solid.
 *
 * The geometry is a purpose-built watertight solid (see {@link makeWatertight}
 * and solidForNode), scaled from metres to MILLIMETRES — the unit every slicer
 * and CAD tool assumes (a metre-scale part would import 1000x too small). STL is
 * geometry only; OBJ and GLB also carry a neutral material.
 */

export const STL_MIME = 'model/stl';
export const OBJ_MIME = 'model/obj';
export const GLB_MIME = 'model/gltf-binary';

/** Metres -> millimetres: the scale every slicer/CAD importer expects. */
const M_TO_MM = 1000;

/** A watertight, millimetre-scaled mesh of one solid, ready for an exporter. */
function meshGroup(geometry: THREE.BufferGeometry): THREE.Group {
  const group = new THREE.Group();
  group.add(new THREE.Mesh(makeWatertight(geometry), new THREE.MeshStandardMaterial({ color: 0xcfcabf })));
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
      (err) => reject(err instanceof Error ? err : new Error(String(err))),
      { binary: true },
    );
  });
}

/** File-system-safe base name (shared with the .ork/.CDX1 writers' style). */
export function safeName(name: string | undefined): string {
  return (name || 'part').trim().replace(/[^a-z0-9._-]+/gi, '_') || 'part';
}

/** Trigger a browser download of some bytes/text. */
export function downloadFile(data: BlobPart, filename: string, mime: string): void {
  void saveBlob(new Blob([data], { type: mime }), filename);
}
