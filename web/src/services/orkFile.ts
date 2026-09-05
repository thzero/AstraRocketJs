/**
 * .ork import/export for full component trees (P2.5 — all 17 editor types).
 *
 * XML structure/element names are taken from GOLDEN files produced by the
 * real OpenRocket 24.12 GeneralRocketSaver (engine-java/tools/GenerateOrk
 * `generate` + `kitchensink`), and exports are validated against the real
 * GeneralRocketLoader. A .ork is either a ZIP containing rocket.ork or bare
 * XML — both are accepted; export writes bare XML.
 */

export { shapeParamDefault } from '../tree/shapeProfile';

export * from './orkTypes';
export * from './orkImport';
export * from './orkExport';
