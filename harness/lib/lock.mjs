// Cross-process lock using an atomic mkdir. Protects read-modify-write of one task file.
import { mkdirSync, rmSync, statSync } from 'node:fs';

const TIMEOUT_MS = 10_000;
const STALE_MS = 60_000;
const RETRY_MS = 50;
const sleeper = new Int32Array(new SharedArrayBuffer(4));

function tryAcquire(lockPath) {
  try {
    mkdirSync(lockPath);
    return true;
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
    const age = Date.now() - statSync(lockPath, { throwIfNoEntry: false })?.mtimeMs;
    if (age > STALE_MS) rmSync(lockPath, { recursive: true, force: true });
    return false;
  }
}

export function withLock(lockPath, fn) {
  const deadline = Date.now() + TIMEOUT_MS;
  while (!tryAcquire(lockPath)) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for lock ${lockPath}`);
    Atomics.wait(sleeper, 0, 0, RETRY_MS);
  }
  try {
    return fn();
  } finally {
    rmSync(lockPath, { recursive: true, force: true });
  }
}
