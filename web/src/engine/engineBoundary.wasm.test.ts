import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * The SHIPPED target's boundary behavior.
 *
 * Every other test in this directory loads `vendor/openrocket-engine.mjs` -
 * the JavaScript build. The app loads WASM-GC when the browser supports it and
 * only falls back to JS, so **the build the tests vouched for is not the build
 * users run**.
 *
 * That gap matters specifically for ERROR behavior, because the two backends
 * genuinely differ there and the difference runs the wrong way:
 *
 *   - TeaVM's JS backend converts a native JavaScript error caught inside a
 *     Java `try` into a `java.lang.RuntimeException`, so the facade's
 *     `catch (RuntimeException e) { return errorJson(e); }` DOES catch a stack
 *     overflow and hands back an `{"error": ...}` envelope.
 *   - WASM-GC has no equivalent. A wasm trap is not a `WebAssembly.Exception`
 *     carrying the `teavm.javaException` tag, so no Java catch clause ever sees
 *     it and it unwinds straight out of the module.
 *
 * So the error handling the facade appears to have does not exist on the
 * target that ships. It cannot be fixed in our Java - there is no catch that
 * sees a trap - which is why the real defense is bounding the inputs
 * (`JsonLite.MAX_DEPTH`, the aero-sweep point cap, `ComponentFactory`'s count
 * caps). See docs/AUDIT_ENGINE.md A4.
 *
 * This file exists so that stays TRUE rather than remembered: it runs the bad
 * inputs against WASM and asserts the bounds hold there too. If someone adds an
 * unbounded path and relies on the catch, this is where it shows up.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC_ENGINE = join(here, '..', '..', 'public', 'engine');

let wasm: any;
let js: any;

/** Load the WASM-GC build exactly as tryLoadWasm() does: runtime IIFE, then bytes. */
async function loadWasm(): Promise<any> {
  const g = globalThis as any;
  g.$rt_putStdoutCustom ??= () => {};
  g.$rt_putStderrCustom ??= () => {};
  if (!g.TeaVM?.wasmGC) {
    await import(pathToFileURL(join(PUBLIC_ENGINE, 'openrocket-engine.wasm-runtime.js')).href);
  }
  const bytes = readFileSync(join(PUBLIC_ENGINE, 'openrocket-engine.wasm'));
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const teavm = await g.TeaVM.wasmGC.load(buf);
  return teavm.exports;
}

const NOSE = { type: 'nosecone', id: 'n', shape: 'ogive', length: 0.07, aftRadius: 0.013, thickness: 0.001 };
const TUBE = { type: 'bodytube', id: 'b', length: 0.3, outerRadius: 0.013, thickness: 0.0005 };
const tree = (extra: unknown[] = []) => JSON.stringify({ components: [NOSE, TUBE, ...extra] });

/** What a call did, without caring which mechanism reported it. */
function outcome(fn: () => unknown): { kind: 'threw' | 'envelope' | 'ok'; message: string } {
  try {
    const r = fn();
    if (typeof r === 'string' && r.includes('"error"')) {
      return { kind: 'envelope', message: String(JSON.parse(r).error) };
    }
    return { kind: 'ok', message: typeof r === 'string' ? r.slice(0, 120) : String(r) };
  } catch (e) {
    return { kind: 'threw', message: e instanceof Error ? e.message : String(e) };
  }
}

beforeAll(async () => {
  wasm = await loadWasm();
  js = await import('./vendor/openrocket-engine.mjs');
}, 120_000);

describe('the harness is really driving WASM', () => {
  // Guarding the guard. Every assertion below is worthless if `wasm` quietly
  // ended up being the JS module - the two-target comparison would be JS
  // against itself and pass vacuously. Today's defaults test shipped in
  // exactly that state until a deliberately wrong value failed to fail.
  it('loaded a distinct module through TeaVM.wasmGC', () => {
    expect(wasm).toBeTruthy();
    expect(js).toBeTruthy();
    expect(wasm).not.toBe(js);
    expect((globalThis as any).TeaVM?.wasmGC?.load).toBeTypeOf('function');
    // The JS build is an ES module namespace; the WASM exports object is not.
    expect(Object.prototype.toString.call(js)).toBe('[object Module]');
    expect(Object.prototype.toString.call(wasm)).not.toBe('[object Module]');
  });

  it('the two modules hold independent handle tables', () => {
    // If `wasm` were `js`, resetting one would clear the other and this fails.
    js.reset();
    wasm.reset();
    const jsHandle = js.buildRocket(tree());
    wasm.reset();
    // Resetting WASM must NOT invalidate the JS handle.
    expect(() => JSON.parse(js.getStaticInfo(jsHandle))).not.toThrow();
    expect(JSON.parse(js.getStaticInfo(jsHandle)).error).toBeUndefined();
  });
});

describe('the shipped WASM-GC build enforces the same input bounds as JS', () => {
  // These are the inputs that used to reach an unbounded loop, an unbounded
  // allocation or a stack overflow. On WASM those failures would NOT have been
  // catchable, so it matters that the bound fires before the kernel gets there.
  const cases: Array<[name: string, call: (e: any) => unknown, expected: RegExp]> = [
    [
      'JSON nested past MAX_DEPTH is refused, not a stack overflow',
      (e) => e.buildRocket(`{"components":${'['.repeat(4000)}${']'.repeat(4000)}}`),
      /nesting deeper than/,
    ],
    [
      'a non-finite numeric literal is refused',
      (e) => e.buildRocket('{"components":[{"type":"bodytube","id":"b1","length":1e999,"outerRadius":0.012}]}'),
      /non-finite/,
    ],
    [
      'an uncapped instance count is refused',
      (e) => e.buildRocket(tree([{ type: 'bodytube', id: 'h', length: 0.2, outerRadius: 0.013,
        children: [{ type: 'podset', id: 'p', instanceCount: 100000 }] }])),
      /instanceCount/,
    ],
    [
      'an over-large aero sweep is refused',
      (e) => {
        const h = e.buildRocket(tree());
        return e.getAeroSweep(h, JSON.stringify({ machMin: 0, machMax: 1e9, machStep: 0.05 }));
      },
      /exceeds|over the/,
    ],
  ];

  it.each(cases)('%s', (_name, call, expected) => {
    wasm.reset();
    const got = outcome(() => call(wasm));
    expect(got.kind, `expected a refusal, got ${got.kind}: ${got.message}`).not.toBe('ok');
    expect(got.message).toMatch(expected);
  });

  it('a sub-ulp sweep step terminates instead of looping forever', () => {
    wasm.reset();
    const h = wasm.buildRocket(tree());
    // Before the integer point-count guard this never returned: machMin ===
    // machMax made the divide-based check pass, and `m += 1e-300` made no
    // progress. A hang here is the regression, so the assertion is that it
    // returns at all.
    const out = JSON.parse(wasm.getAeroSweep(h, JSON.stringify({ machMin: 0.05, machMax: 0.05, machStep: 1e-300 })));
    expect(out.machs).toEqual([0.05]);
  });
});

describe('both targets agree on the errors the facade can actually report', () => {
  // Where the facade returns an `{"error"}` envelope, the two backends MUST
  // agree - that path does not depend on how exceptions cross the boundary.
  const enveloped: Array<[name: string, call: (e: any) => unknown]> = [
    ['an unknown handle', (e) => e.simulateJson(99999, '{}')],
    ['a malformed options blob', (e) => e.simulateJson(e.buildRocket(tree()), '{oops')],
    ['an unknown component type', (e) => e.getComponentInfo(e.buildRocket(tree()), 'nope')],
  ];

  it.each(enveloped)('%s reports identically on JS and WASM', (_name, call) => {
    js.reset();
    wasm.reset();
    const a = outcome(() => call(js));
    const b = outcome(() => call(wasm));
    expect(b.kind).toBe(a.kind);
    expect(b.message).toBe(a.message);
  });
});

describe('the shipped build computes what the JS build computes', () => {
  it('same rocket, same static info', () => {
    js.reset();
    wasm.reset();
    const a = JSON.parse(js.getStaticInfo(js.buildRocket(tree())));
    const b = JSON.parse(wasm.getStaticInfo(wasm.buildRocket(tree())));
    // Parity already proves this to the ULP across 342 lines; this is a cheap
    // guard that the WASM artifact under test is not stale relative to the JS
    // one, so a failure above cannot be an artifact-mismatch artifact.
    expect(b.mass).toBeCloseTo(a.mass, 12);
    expect(b.cg).toBeCloseTo(a.cg, 12);
    expect(b.cp).toBeCloseTo(a.cp, 12);
  });
});
