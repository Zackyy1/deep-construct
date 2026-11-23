import { spawnSync } from 'node:child_process';

const OUTPUT_TAIL_CHARS = 4000;

// Runs each configured check and records the raw exit code and the end of its output, word for word.
export function runChecks(checks, cwd, timeoutMs) {
  return Object.entries(checks).map(([name, command]) => {
    const r = spawnSync(command, { cwd, shell: true, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
    const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    const timedOut = r.error?.code === 'ETIMEDOUT';
    return {
      name,
      command,
      exitCode: r.status ?? -1,
      ...(timedOut && { error: `timed out after ${timeoutMs}ms` }),
      ...(r.error && !timedOut && { error: r.error.message }),
      outputTail: output.slice(-OUTPUT_TAIL_CHARS),
    };
  });
}
