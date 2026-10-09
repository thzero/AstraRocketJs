/**
 * .ork import/export for full component trees (every editor component type).
 *
 * XML structure/element names follow files written by OpenRocket 24.12's
 * GeneralRocketSaver, and exports are meant to load in its GeneralRocketLoader.
 * A .ork is either a ZIP containing rocket.ork or bare XML; both are accepted,
 * and export writes bare XML.
 */

export * from './orkTypes';
export * from './orkImport';
export * from './orkExport';
