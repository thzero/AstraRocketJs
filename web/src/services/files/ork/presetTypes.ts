/**
 * The `<preset type="...">` vocabulary, which is the kernel's enum and not ours.
 *
 * `ComponentPreset.Type` is what the desktop writes and parses: `NOSE_CONE`,
 * `BODY_TUBE`, `CENTERING_RING` and the rest, verbatim from the enum constant.
 * Our catalog rows use the same lowercase names the component tree uses, so the
 * two have to be mapped rather than passed through: a file written with
 * `type="nosecone"` names a type the desktop's `Type.valueOf` does not have.
 *
 * Both directions, because an imported design's links have to come back as our
 * own vocabulary for the picker and the panel to recognize them.
 */

/**
 * Our catalog row type → the kernel's `ComponentPreset.Type` constant.
 *
 * Maps rather than plain objects: the key comes from a file, and `constructor`
 * or `__proto__` would otherwise resolve to Object.prototype members.
 */
const TO_KERNEL = new Map<string, string>(
  Object.entries({
    nosecone: 'NOSE_CONE',
    bodytube: 'BODY_TUBE',
    transition: 'TRANSITION',
    centeringring: 'CENTERING_RING',
    tubecoupler: 'TUBE_COUPLER',
    bulkhead: 'BULK_HEAD',
    engineblock: 'ENGINE_BLOCK',
    launchlug: 'LAUNCH_LUG',
    railbutton: 'RAIL_BUTTON',
    parachute: 'PARACHUTE',
    streamer: 'STREAMER',
  }),
);

const TO_APP = new Map<string, string>([...TO_KERNEL].map(([k, v]) => [v, k]));

/** The enum constant for a row type, or '' when it is not one the kernel has. */
export const kernelPresetType = (type: string | undefined): string => (type ? (TO_KERNEL.get(type) ?? '') : '');

/**
 * The row type for an enum constant.
 *
 * Falls back to the lowercased original, so a file that already carried our
 * spelling (or a constant added upstream after this map was written) still reads
 * as something rather than as nothing.
 */
export const appPresetType = (type: string | undefined): string =>
  type ? (TO_APP.get(type) ?? type.toLowerCase()) : '';
