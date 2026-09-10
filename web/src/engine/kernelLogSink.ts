/**
 * Silences the TeaVM kernel's stdout/stderr so it never reaches the browser
 * console.
 *
 * WHY THIS FILE EXISTS: OpenRocket's core logs at INFO through the whole
 * simulation ("Starting simulation of branch", "Igniting motor", …). TeaVM's
 * runtime wires Java's System.out/System.err to console.info/console.error, so
 * every single flight wrote several lines to the browser console AS ERRORS —
 * noise that buries the real errors a beta tester would need to report, and
 * false positives for anything watching console.error.
 *
 * TeaVM's runtime picks its output sinks with
 *   $rt_putStdout = typeof $rt_putStdoutCustom === "function" ? … : console.info
 *   $rt_putStderr = typeof $rt_putStderrCustom === "function" ? … : console.error
 * evaluated ONCE, at module-evaluation time, reading bare (global) identifiers.
 * So these globals must be installed BEFORE vendor/openrocket-engine.mjs evaluates —
 * which is why this is a side-effect module imported above it in openRocketEngine.ts
 * (ES modules evaluate in import order) rather than plain code in that file.
 */

// A no-op sink: TeaVM buffers whole lines and hands them here; we drop them.
const drop = (): void => {};

// Install before the kernel module evaluates. Assigning onto globalThis is what
// makes TeaVM's bare-identifier `typeof $rt_putStdoutCustom` resolve to these:
// the vendored module never declares those names itself, so the lookup reaches
// the global scope.
const g = globalThis as Record<string, unknown>;
if (typeof g.$rt_putStdoutCustom !== 'function') g.$rt_putStdoutCustom = drop;
if (typeof g.$rt_putStderrCustom !== 'function') g.$rt_putStderrCustom = drop;
