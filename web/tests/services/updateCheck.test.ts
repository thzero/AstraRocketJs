import { describe, it, expect } from 'vitest';
import {
  UPDATE_MIN_GAP_MS,
  UPDATE_POLL_MS,
  UPDATE_SNOOZE_MS,
  dueForCheck,
  promptDue,
  snoozeUntil,
} from '../../src/services/updateCheck';

const T = 1_700_000_000_000;

describe('dueForCheck', () => {
  it('is due when nothing has been checked yet', () => {
    expect(dueForCheck(null, T)).toBe(true);
  });

  it('holds off until the floor has passed, then allows one', () => {
    // The visibility and online triggers fire as often as the user alt-tabs, and
    // each check is a real request for the worker. Without the floor a restless
    // afternoon becomes a poll loop.
    expect(dueForCheck(T, T + 1000)).toBe(false);
    expect(dueForCheck(T, T + UPDATE_MIN_GAP_MS - 1)).toBe(false);
    expect(dueForCheck(T, T + UPDATE_MIN_GAP_MS)).toBe(true);
  });

  it('takes a caller-supplied gap', () => {
    expect(dueForCheck(T, T + 1000, 500)).toBe(true);
    expect(dueForCheck(T, T + 1000, 5000)).toBe(false);
  });
});

describe('promptDue', () => {
  it('shows when nothing is snoozed', () => {
    expect(promptDue(null, T)).toBe(true);
  });

  it('stays quiet until the snooze expires, boundary included', () => {
    const until = snoozeUntil(T);
    expect(promptDue(until, T)).toBe(false);
    expect(promptDue(until, until - 1)).toBe(false);
    expect(promptDue(until, until)).toBe(true);
    expect(promptDue(until, until + 1)).toBe(true);
  });
});

describe('the intervals themselves', () => {
  it('poll less often than the floor, so the floor never blocks a poll', () => {
    // A poll that arrived inside its own rate limit would silently do nothing,
    // and the hourly check would become a no-op.
    expect(UPDATE_POLL_MS).toBeGreaterThan(UPDATE_MIN_GAP_MS);
  });

  it('snooze for hours, not seconds', () => {
    // "Later" replaced a dismissal that lasted the whole session. It has to come
    // back, and it has to not nag.
    expect(UPDATE_SNOOZE_MS).toBeGreaterThanOrEqual(UPDATE_POLL_MS);
    expect(snoozeUntil(T)).toBe(T + UPDATE_SNOOZE_MS);
    expect(snoozeUntil(T, 1000)).toBe(T + 1000);
  });
});
