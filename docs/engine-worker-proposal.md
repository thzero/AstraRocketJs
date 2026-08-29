# Proposal: run the engine off the main thread (Web Worker)

> Design proposal / decision record. Status: **Phase 1 (Option B) implemented;
> Phases 2–3 proposed.** Companion to [ARCHITECTURE.md](./ARCHITECTURE.md).
> Documents two options (A and B) and the incremental roadmap from B to A.

## Problem

The physics engine is **synchronous** and runs on the main thread. A flight
simulation is a one-shot compute of ~500 ms (`store.ts` `runSim` →
`OpenRocketDesign.simulate()`). While it runs, the main thread is blocked: the
"Simulating…" spinner can't animate smoothly, and pan/zoom/edit/roll all freeze
for that half-second. Chrome flags it as a `[Violation] 'setTimeout' handler
took ~480ms`.

The fix is to move engine work to a **Web Worker** so the main thread stays
responsive. The question is *how much* of the engine to move, and in what order.

## Relevant current architecture

- `web/src/engine/openRocketEngine.ts` — the typed wrapper. `initEngine()` loads
  the WASM-GC backend (JS fallback); `eng()` returns the active engine module;
  the `OpenRocketDesign` class holds an integer **rocket handle** and exposes
  **synchronous** methods: `staticInfo()`, `simulate()`, `getDragSweep()`,
  `getComponentInfo()`.
- `web/src/engine/api.ts` — `buildRocketTree(tree, motor, mountId)` → an
  `OpenRocketDesign`; `specToTree`, `C6`.
- `web/src/state/store.ts` — holds the live `rocket` handle; `runSim` calls
  `rocket.simulate(simConditions(launch, prefs))`.
- `web/src/state/useWorkspaceEffects.ts` — the **rebuild effect**: on any
  tree/motor edit, calls `buildRocketTree(...)` + `staticInfo()` **synchronously**
  and pushes CG/CP/stability into the store. This runs on *every keystroke* and
  is fast (~4 ms).

Key properties that shape the design:

- The engine is **stateful and handle-based** — `buildRocket(json)` returns an
  int handle kept in an in-engine registry; every other call passes that handle.
- `simulate()` / `staticInfo()` / `getDragSweep()` already return
  **`JSON.parse`'d plain objects** → they are structured-cloneable and cross
  `postMessage` for free.
- Aero flags (`setSupersonicAero` / `setRogersModifiedBarrowman`) are **not**
  called from web code today; sims run on defaults.

---

## Option A — whole engine in the worker

The engine lives **only** in the worker. The main thread holds a thin **async
proxy**: every engine call (`staticInfo`, `dragSweep`, `componentInfo`,
`simulate`) becomes a `postMessage` round-trip returning a `Promise`.

```
Main thread                         Worker
-----------                         ------
async proxy  ── build(tree) ──▶     engine (WASM/JS), handle registry
             ── staticInfo(h) ─▶    computes, posts result
             ── simulate(h,o) ─▶
```

**Pros**
- Single engine instance (no double load / double memory).
- The main thread **never** blocks on *any* engine op — maximally responsive.
- One source of truth for engine state.

**Cons**
- **Large ripple:** every synchronous consumer becomes async — the rebuild
  effect, `InfoOverlay`, `DragAnalysis`, `getComponentInfo`, selection panels.
- `staticInfo`-on-every-keystroke becomes an async round-trip, so the rebuild
  path needs debounce + out-of-order (last-write-wins) handling to keep live
  CG/CP feeling instant.
- Higher risk; bigger diff; harder to verify incrementally.

**When it's right:** the end state, once we want *all* engine work off-thread.

---

## Option B — dedicated sim worker (recommended first step)

Keep the synchronous main-thread engine for **interactive** work (live CG/CP on
every edit, drag analysis). Add a **second** engine instance in a worker that
does **only** the heavy flight sim.

```
Main thread                              Sim worker
-----------                              ----------
engine (WASM)  ← staticInfo/dragSweep     engine (WASM/JS)
   (sync, unchanged)                      on {tree,motor,mountId,options}:
simClient  ── simulate(payload) ──▶         buildRocketTree → simulate → post result
```

- **New:** `web/src/engine/simWorker.ts` (module worker: `initEngine()`, builds
  the rocket from the posted tree, simulates, posts the result) and
  `web/src/engine/simClient.ts` (spawns/warms the worker, correlates requests by
  id, returns a `Promise<FlightResult>`).
- **Changed (small):** `store.ts` `runSim` becomes `async` and awaits
  `simulateInWorker(...)` instead of the `setTimeout` + sync `simulate`;
  `openRocketEngine.ts` `loadWasmRuntime` gains a worker branch (workers have no
  `document`, so `fetch` + eval the runtime instead of injecting a `<script>`).

**Pros**
- **Tiny ripple:** only `runSim` changes. The `OpenRocketDesign` class and every
  synchronous consumer stay exactly as they are.
- Kills the reported jank; the interactive path stays instant and sync.
- Low risk; covered by the existing e2e sim test.
- Sim's `[INFO]` log spam moves into the worker's log ring, off the main console.

**Cons**
- **Two engine instances** (main + worker): ~2× compile + a few MB memory. The
  `.wasm`/`.mjs` fetch is browser-cached, so it's one network download.
- Only the sim is off-thread; `dragSweep` etc. still block (briefly) on main.

**Backend in the worker:** aim for **WASM-in-worker** (needs the `loadWasmRuntime`
worker branch). Guaranteed fallback: **JS-in-worker** — the JS `.mjs`
dynamic-imports fine in a module worker; the sim runs a little slower there but
it's *off-thread*, so the UI is smooth either way.

---

## A vs B at a glance

| | **A — whole engine in worker** | **B — dedicated sim worker** |
|---|---|---|
| What moves off-thread | Everything | Only `simulate` |
| Main-thread engine | Removed (async proxy) | Kept (sync) for interactive ops |
| Consumer ripple | Large (all async) | Tiny (only `runSim`) |
| Engine instances | 1 | 2 (main + worker) |
| `staticInfo` per edit | Async round-trip | Sync, unchanged |
| Risk / diff size | High / large | Low / small |
| Role | End state | First step |

**Decision: ship B first, evolve to A.** B solves the actual pain with minimal
risk, and — critically — every line of its transport is reused by A.

---

## Roadmap: B → A

The one forward-compat decision made in B: the worker protocol is a **generic
method-dispatch RPC** (`call(method, args) → Promise<result>` with a request-id
map), **not** a bespoke "simulate" message. Adding operations later needs no
protocol change. With that in place, the path is incremental and each phase ships
on its own.

### Phase 1 — B: sim off-thread *(solves the jank)* — ✅ DONE
- `engine/simWorker.ts` + `engine/simClient.ts` + `engine/simProtocol.ts`
  (generic RPC transport); shared `services/buildRocket.ts` so the worker builds
  the identical rocket the main thread does.
- `runSim` → `async`, routes through the worker (worker builds + simulates per
  call — stateless, `resetEngine()` between runs).
- Main thread keeps its engine for `staticInfo` / `dragSweep` / `componentInfo`.
- Worker loads WASM by `fetch`ing the runtime text and importing it via a Blob
  URL (no `document`/`<script>` and no eval in a worker; Vite also blocks
  `import()` of `/public` files, and blob URLs sidestep that wall).
  `vite.config` needs `worker.format: 'es'` for the code-split worker bundle.
- **Verified:** e2e green (incl. a new "UI stays responsive" test — max
  main-thread stall dropped ~480 ms → ~30 ms); prod build + preview sim OK.

### Phase 2 — bridge: worker gains state + `dragSweep`
- Add a **persistent handle registry** in the worker: an edit posts
  `build(tree,motor,mountId) → handle`; subsequent ops reuse it instead of
  rebuilding per call.
- Move `getDragSweep` (the Aero view) into the worker — next-heaviest op, and
  on-demand, so making it async is easy and low-risk.
- Main thread still owns `staticInfo` for the live-edit path.

### Phase 3 — A: main thread becomes a pure async proxy
- Move `staticInfo` + `getComponentInfo` into the worker.
- Make the **rebuild effect async**: debounce edits, last-write-wins on
  out-of-order responses so live CG/CP still feels instant while dragging.
- Delete the main-thread engine instance (single instance again).

### What carries forward vs. what's added

| | Reused from B | Added by A |
|---|---|---|
| Worker file (`simWorker.ts`) | ✅ pattern + engine load | more op handlers |
| Client plumbing (`simClient.ts`) | ✅ spawn, id-map, errors | more proxy methods |
| `loadWasmRuntime` worker branch | ✅ | — |
| Worker warming | ✅ | — |
| Worker handle registry | (Phase 2) | persistent state |
| Async consumers | — | rebuild effect, DragAnalysis, InfoOverlay, … |
| Drop 2nd engine instance | — | ✅ |

The async-consumer refactor is A's real cost and is **inherent to A regardless**
of whether B came first — B neither adds to it nor blocks it. B just builds all
the transport A needs.

## Caveats

- **`staticInfo` per keystroke going async (Phase 3):** ~4 ms sync call becomes a
  ~1–2 ms message + compute + serialize round-trip. Still fast, but async — needs
  debounce + last-write-wins so live CG/CP feels instant. This is the main reason
  it's deferred to Phase 3.
- **Two engine instances during Phases 1–2:** acceptable (cached fetch, cheap
  second compile). Removed in Phase 3.
- **Worker WASM loading:** the `<script>`-injection path doesn't exist in a
  worker; `fetch` + eval the runtime instead. If it ever fails, JS-in-worker is
  the drop-in fallback.

## Recommendation

Build **Phase 1 (Option B)** now: generic-RPC transport, WASM-in-worker with JS
fallback, sim only. It removes the main-thread freeze immediately and lays the
foundation for Phases 2–3 toward Option A when we want the rest off-thread.
