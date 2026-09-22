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
/**
 * The same shape, anchored: the WHOLE string is one key.
 *
 * Built from the literal above via `.source` rather than from a shared pattern
 * STRING. A string would have to escape its own backslashes on top of the
 * regex's, which is a silent trap - `'\[...'` compiles to the pattern `[...`
 * and throws at module load - and it costs a regex literal that editors and
 * lint rules can actually see.
 */
const WHOLE_SOURCE_KEY = new RegExp(`^${SOURCE_KEY.source}$`);

/**
 * True when this name is the kernel's own default for the part rather than one
 * the user typed.
 *
 * Callers that only want to DISPLAY the name do not need this - `componentName`
 * handles both. It is for the caller that has to decide something else: the
 * flight-path export names a recovery pin after the device when the user named
 * it, and after the event when they did not, and by the time the name has been
 * translated that distinction is gone.
 */
export function isDefaultComponentName(raw: string): boolean {
  return WHOLE_SOURCE_KEY.test(raw);
}

/**
 * The kernel's default component names to this app's own key for the same part.
 *
 * Keyed by the WHOLE bundle key the kernel looks its name up under, because
 * that is what arrives and because the two halves do not always agree
 * (`EllipticalFinSet.Ellipticalfinset`).
 *
 * Transcribed from the `getComponentName()` overrides in
 * `engine-java/src/java/info/openrocket/core/rocketcomponent/*.java` - from the
 * kernel source, not from another copy of this list, which is the only way this
 * table can be checked. Deriving the key by lowercasing the namespace would fit
 * all but one row and then silently fall back to English for anything renamed
 * on either side; the spelled-out table can be, and is, asserted against the
 * bundle.
 *
 * Three of the kernel's names are deliberately absent, because nothing in this
 * app names those things: `Rocket.compname.Rocket` (the design root, which is
 * not a part), `Sleeve.Sleeve` and `RemovedComponent.COMPONENT_REMOVED`. They
 * fall back to the humanized key, as everything did before this table existed.
 */
export const COMPONENT_PART_KEYS: Record<string, string> = {
  'BodyTube.BodyTube': 'part.bodytube',
  'BoosterSet.BoosterSet': 'part.parallelstage',
  'Bulkhead.Bulkhead': 'part.bulkhead',
  'CenteringRing.CenteringRing': 'part.centeringring',
  'EllipticalFinSet.Ellipticalfinset': 'part.ellipticalfinset',
  'EngineBlock.EngineBlock': 'part.engineblock',
  'FreeformFinSet.FreeformFinSet': 'part.freeformfinset',
  'InnerTube.InnerTube': 'part.innertube',
  'LaunchLug.Launchlug': 'part.launchlug',
  'MassComponent.MassComponent': 'part.masscomponent',
  'NoseCone.NoseCone': 'part.nosecone',
  'Parachute.Parachute': 'part.parachute',
  'PodSet.PodSet': 'part.podset',
  'RailButton.RailButton': 'part.railbutton',
  'ShockCord.ShockCord': 'part.shockcord',
  'Stage.Stage': 'part.stage',
  'Streamer.Streamer': 'part.streamer',
  'Transition.Transition': 'part.transition',
  'TrapezoidFinSet.TrapezoidFinSet': 'part.trapezoidfinset',
  'TubeCoupler.TubeCoupler': 'part.tubecoupler',
  'TubeFinSet.TubeFinSet': 'part.tubefinset',
};

/**
 * A kernel-supplied component name, in the reader's language.
 *
 * A part the user renamed arrives as the name they typed and is returned
 * untouched - only the bracket form is a key, and rewriting somebody's own name
 * for their own part would be the worse bug.
 *
 * One they never renamed arrives as the bundle key its default name is looked
 * up under, because the TeaVM kernel carries no resource bundles. That is
 * translated through {@link COMPONENT_PART_KEYS}, so `[Parachute.Parachute]`
 * reads as this app's own name for a parachute, in the language it is asked
 * for. A key the table does not cover degrades to its readable half rather than
 * disappearing.
 *
 * Shared with {@link warningText} rather than copied, so a component named one
 * way in the warnings panel is not named another way in an export. Its other
 * consumer is the flight-path export, where the name reaches a KML placemark
 * and a summary balloon - and where the language can differ from the app's,
 * which is why the translator is a parameter rather than a module import.
 */
export function componentName(raw: string, translate: (key: string) => string | undefined): string {
  return raw.replace(SOURCE_KEY, (_all, ns: string, name: string) => {
    const key = COMPONENT_PART_KEYS[`${ns}.${name}`];
    const translated = key ? translate(key) : undefined;
    return translated && translated !== key ? translated : humanize(name);
  });
}

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
  const rest = componentName(message.slice(m[0].length).trim().replace(/:\s+/g, ': '), translate);
  if (!rest) return head;
  return rest.startsWith(':') ? `${head}${rest}` : `${head} ${rest}`;
}
