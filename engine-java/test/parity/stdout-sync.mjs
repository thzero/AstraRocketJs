/**
 * Write to stdout synchronously, without being able to hang or throw doing it.
 *
 * Both halves of the parity harness end the same way: print a result, then
 * process.exit(). That is only safe if the bytes are already gone when exit()
 * runs, and console.log cannot promise that - to a PIPE it is synchronous on
 * Linux but ASYNCHRONOUS on Windows, so an exit() straight after it truncates
 * the last line there. fs.writeSync is a write(2) syscall on every platform,
 * which is the property that is actually wanted.
 *
 * The loop and the catch are not decoration. writeSync assumes a BLOCKING fd,
 * which fd 1 is in the two places this runs (a GitHub runner hands bash a plain
 * blocking pipe, and libuv clears O_NONBLOCK on the child's fds 0-2 when
 * spawnSync forks). On a fd that is somehow non-blocking anyway, writeSync can
 * come back having written only part of the buffer, or throw EAGAIN outright -
 * and an uncaught EAGAIN here would fail a parity run that had already passed.
 * The fallback covers both, and touching process.stdout sets the fd blocking on
 * its way through, which fixes the condition as a side effect.
 *
 * Nothing in here can block indefinitely: no callback, no timer, no promise, no
 * event loop, and no unbounded retry. That is the whole point, and the exit
 * note at the bottom of parity.mjs says what happens when it is not honored.
 */
import { writeSync } from 'node:fs';

/**
 * The child's "I got to the end" marker, and the ONLY thing that means success.
 *
 * run-target.mjs cannot exit normally (see the note at the bottom of it), so it
 * leaves by SIGKILL and has no exit status to report with. It prints this as
 * its last line instead; parity.mjs strips it and treats its absence as a
 * failed target. Deliberately not a value that could occur in parity output,
 * which is `name|number|number|...`.
 */
export const TARGET_COMPLETE = '###teavm-target-complete###';

export function writeStdoutSync(text) {
  const buf = Buffer.from(text, 'utf8');
  let written = 0;
  try {
    while (written < buf.length) {
      const n = writeSync(1, buf, written);
      // Cannot happen on a blocking fd. If it somehow does, hand over to the
      // fallback rather than spinning on a fd that is not accepting bytes.
      if (n <= 0) break;
      written += n;
    }
  } catch {
    // EAGAIN, EPIPE, anything: the fallback below decides what is left to do.
  }
  if (written >= buf.length) return;

  try {
    // NOTE for callers that capture output by replacing process.stdout.write:
    // restore the real one before calling this, or the fallback feeds the
    // remainder straight back into the capture and it is lost.
    process.stdout.write(buf.subarray(written));
  } catch {
    // stdout is gone (the reader closed, say). The EXIT CODE still carries the
    // verdict, which is what CI reads; do not fail a passing run over a line of
    // log output.
  }
}
