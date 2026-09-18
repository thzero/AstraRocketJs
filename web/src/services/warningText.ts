/**
 * Turn a kernel warning message into something a person can read.
 *
 * The engine is OpenRocket's core compiled through TeaVM, and TeaVM carries no
 * resource bundles — so the kernel's own `trans.get("Warning.DISCONTINUITY")`
 * returns the LOOKUP KEY rather than a translation, and the message arrives as
 *
 *     [Warning.DISCONTINUITY]:  "Nose cone", "Body tube"
 *     [Warning.RECOVERY_HIGH_SPEED] (24.6 m/s):  "Parachute"
 *
 * Everything after the bracket is real content the kernel built: the offending
 * value, and the names of the components involved (`Message.toString()` appends
 * its sources). So this translates the key and keeps the rest verbatim.
 *
 * An unknown key degrades to a de-bracketed, sentence-cased version of itself
 * rather than disappearing: a warning nobody has a string for is still a warning
 * the user needs to see.
 */
const KEY = /^\[Warning\.([A-Za-z0-9_.]+)\]\s*/;

/**
 * A component name that is also an untranslated bundle key.
 *
 * The same TeaVM gap one level down: a component the user never renamed keeps
 * the kernel's default name, which is itself a `trans.get` lookup — so the
 * sources appended to a message arrive as `"[Parachute.Parachute]"`. The part
 * after the dot is the readable half.
 */
const SOURCE_KEY = /\[([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)\]/g;

/** "OPEN_AIRFRAME_FORWARD" -> "Open airframe forward"; "LargeAOA.str2" -> "Large AOA". */
function humanize(key: string): string {
  const base = key.split('.')[0] ?? key;
  if (base.includes('_')) {
    const words = base.toLowerCase().split('_').filter(Boolean);
    const first = words[0] ?? base;
    return [first.charAt(0).toUpperCase() + first.slice(1), ...words.slice(1)].join(' ');
  }
  // CamelCase: split on the boundary, keeping runs of capitals together.
  return base.replace(/([a-z])([A-Z])/g, '$1 $2');
}

/**
 * The kernel's key for a message, or null when it carries none.
 *
 * Taken from the MESSAGE rather than `EngineWarning.key`, which is not the same
 * string: the bridge rewrites a few typed warnings to stable names of its own
 * ("HighSpeedDeployment" for what the message calls RECOVERY_HIGH_SPEED), and
 * design warnings arrive as bare text with no key field at all. Reading it from
 * the message gives both paths one vocabulary.
 */
export function warningKeyOf(message: string): string | null {
  return KEY.exec(message)?.[1] ?? null;
}

/**
 * The longer "why this matters" for a warning, or null when there is none.
 *
 * OpenRocket explains its recovery-speed warnings; ours said only what tripped.
 * A deployment-speed warning that does not say what a fast deployment DOES to
 * the airframe is a number the reader has to already understand to act on.
 */
export function warningHelp(message: string, translate: (key: string) => string | undefined): string | null {
  const key = warningKeyOf(message);
  if (!key) return null;
  const lookup = `warnHelp.${key}`;
  const help = translate(lookup);
  return help && help !== lookup ? help : null;
}

/**
 * @param message the kernel's message, as exported
 * @param translate i18n lookup; returns undefined/the key itself when it has no
 *   string, which is why the fallback is computed here rather than passed in
 */
export function warningText(message: string, translate: (key: string) => string | undefined): string {
  const m = KEY.exec(message);
  if (!m) return message; // already plain text, or a shape we do not recognize
  const key = m[1]!;
  const lookup = `warn.${key}`;
  const translated = translate(lookup);
  const head = translated && translated !== lookup ? translated : humanize(key);
  // The kernel separates the text from its source components with ":  " (two
  // spaces). Normalize that wherever it falls: the value, when there is one,
  // sits between the text and the colon -- "TEXT (24.6 m/s):  "Parachute"".
  const rest = message
    .slice(m[0].length)
    .trim()
    .replace(/:\s+/g, ': ')
    .replace(SOURCE_KEY, (_all, _ns: string, name: string) => humanize(name));
  if (!rest) return head;
  return rest.startsWith(':') ? `${head}${rest}` : `${head} ${rest}`;
}
