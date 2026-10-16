/**
 * The glyph every readout, table cell and report shows for a value that is
 * missing or not finite. An en dash: it sits in jsPDF's built-in WinAnsi font,
 * so the PDF report prints it too.
 *
 * Its own module with no imports, so the unit and motor helpers that also run
 * outside React (exports, the report, the sim worker's dependencies) can use it
 * without loading i18next.
 */
export const NO_VALUE = '\u2013';
