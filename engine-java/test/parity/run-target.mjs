#!/usr/bin/env node
/**
 * Run one vendored engine target's runParity() and print what it printed. Nothing else.
 *
 * This has to be a separate, disposable process.
 *
 * On Linux, a process that has instantiated the WASM-GC module cannot exit: not by
 * falling off the end, not by process.exit(), not after waiting. Its event loop
 * stops running too, so timers armed beforehand never fire. Only a signal gets it
 * out. Measured on Ubuntu 26.04 / node 22.23.2, and merely loading the module is
 * enough; main() need not run. It does not reproduce on Windows, so it shows up
 * only in CI. The bottom of this file has the numbers.
 *
 * So this process does the loading, prints, and is SIGKILLed: by itself
 * normally, by parity.mjs if it overstays. parity.mjs itself never touches a
 * TeaVM target, so it stays a process that can exit like anything else.
 *
 * Output is buffered here and written once with a synchronous fs.writeSync, not
 * streamed through console.log. console.log to a pipe is asynchronous on
 * Windows, so a process.exit() straight after it can truncate the last line;
 * writeSync cannot, on any platform. It also means nothing is in a buffer when
 * the SIGKILL lands.
 *
 *   node test/parity/run-target.mjs js
 *   node test/parity/run-target.mjs wasm
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TARGET_COMPLETE, writeStdoutSync } from './stdout-sync.mjs';

const target = process.argv[2];
if (target !== 'js' && target !== 'wasm') {
  console.error('usage: node test/parity/run-target.mjs <js|wasm>');
  process.exit(2);
}

const here = dirname(fileURLToPath(import.meta.url));
// The files the app loads, which parity.mjs has just built and vendored.
const webRoot = resolve(here, '..', '..', '..', 'web');
const wasmDir = join(webRoot, 'public', 'engine');

// The target writes through console.log in-process, so it is captured rather
// than piped.
//
// The real process.stdout.write is kept, not because a throw has to leave
// this process usable (it is about to die either way), but because
// writeStdoutSync falls back to process.stdout.write if the raw
// syscall cannot place the bytes, and if the capture were still installed at
// that point the fallback would feed the whole run's output back into
// `captured` and print nothing.
const realStdoutWrite = process.stdout.write.bind(process.stdout);
let captured = '';
console.log = (msg) => { captured += String(msg) + '\n'; };
process.stdout.write = (chunk) => { captured += String(chunk); return true; };

if (target === 'wasm') {
  // The runtime is an IIFE that installs globalThis.TeaVM.wasmGC.{load,...}.
  (0, eval)(readFileSync(join(wasmDir, 'openrocket-engine.wasm-runtime.js'), 'utf8'));

  // Bytes, not a path. This does not fix the hang (see the note at the
  // bottom of this file; nothing short of a signal does), but it is right on
  // its own and it avoids a leaked file handle.
  //
  // Handed a string, the runtime's compileModule() opens the file itself:
  //
  //     const fileHandle = await fs.open(src, "r");
  //     const stream = await fileHandle.readableWebStream();
  //     ... WebAssembly.compileStreaming(new Response(stream)) ...
  //     close();                      // <-- never awaited
  //
  // compileStreaming stops reading once the module is complete, so the stream
  // is never drained and that close never lands: the process is left with a
  // permanently in-flight FSReqPromise + FileHandleCloseReq. Handed anything
  // that is not a string, compileModule() takes `WebAssembly.compile(src)` and
  // no file is ever opened. The runtime supports this deliberately (it guards
  // `typeof path !== "string"` when resolving debug info), and it is already
  // how the app loads the engine - see wasmGC.load(bytes, ...) in
  // web/src/engine/openRocketEngine.ts. So this also keeps the harness off
  // a load path the app never uses.
  const wasmBytes = readFileSync(join(wasmDir, 'openrocket-engine.wasm'));
  const teavm = await globalThis.TeaVM.wasmGC.load(wasmBytes);
  teavm.exports.runParity();
} else {
  const mod = await import(pathToFileURL(join(webRoot, 'src', 'engine', 'vendor', 'openrocket-engine.mjs')).href);
  mod.runParity();
}

process.stdout.write = realStdoutWrite;
writeStdoutSync(captured.endsWith('\n') ? captured : captured + '\n');

// The last line, and the only thing that tells parity.mjs this run finished:
// there is no exit status to say it with, because of what comes next.
writeStdoutSync(TARGET_COMPLETE + '\n');

// --- leaving, the only way that works -------------------------------------
//
// Measured on Ubuntu 26.04 / node 22.23.2, WASM-GC target loaded, stdout on a
// pipe, each run capped externally at 20-25s:
//
//   fall off the end, no exit call ....... HUNG   ('beforeExit' never fired)
//   process.exit(0) ...................... HUNG   ('exit' fired, then nothing)
//   await 3s, then process.exit(0) ....... HUNG   (the 3s timer never fired)
//   process.kill(process.pid,'SIGKILL') .. gone in ~1s
//
// The JS target exits cleanly from the same harness (rc=0 in 3s), and so does
// the same script with nothing loaded, so this is specific to instantiating
// WASM-GC. It is a V8/node level defect, not something this repo can fix: the
// event loop stops turning and every graceful exit path blocks behind it.
//
// Passing the wasm as bytes rather than a path (see above) does not lift the
// hang: the process is just as stuck with `requests=[]` as with the file
// handle open, so the handle is not the cause.

//
// Everything above is already flushed by writeStdoutSync, so a signal loses
// nothing. parity.mjs expects this and reads TARGET_COMPLETE, not the status.
process.kill(process.pid, 'SIGKILL');
