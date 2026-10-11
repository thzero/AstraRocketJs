/**
 * .ork import/export for full component trees (every editor component type).
 *
 * XML structure/element names follow files written by OpenRocket 24.12's
 * GeneralRocketSaver, and exports are meant to load in its GeneralRocketLoader.
 * A .ork is either a ZIP containing rocket.ork or bare XML; both are accepted.
 * exportOrk returns the XML; saveOrk zips it with the embedded thrust curves.
 */

export * from './orkTypes';
export * from './orkImport';
export * from './orkExport';
