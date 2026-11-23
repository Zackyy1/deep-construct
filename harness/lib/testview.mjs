// The test engineer's isolated view: while a task is at the "tests" stage, its worktree is a sparse
// checkout holding only tests, contracts and support files. Implementation files are not on disk.
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { testerReadable, toSparsePattern } from './policy.mjs';

const ISOLATED_STATUSES = new Set(['pending', 'in_progress']);

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return { ok: r.status === 0, out: `${r.stdout}${r.stderr}`.trim() };
}

const isSparse = (wt) => git(wt, ['sparse-checkout', 'list']).ok;

export function sparsePatterns(config) {
  return [...new Set(testerReadable(config).filter((g) => !g.includes('node_modules')).map(toSparsePattern))];
}

export function applyTestView(wt, config) {
  const r = git(wt, ['sparse-checkout', 'set', '--no-cone', ...sparsePatterns(config)]);
  if (!r.ok) throw new Error(`could not isolate the test engineer's worktree (commit or stash changes first): ${r.out}`);
}

export function clearTestView(wt) {
  if (!isSparse(wt)) return;
  const r = git(wt, ['sparse-checkout', 'disable']);
  if (!r.ok) throw new Error(`could not restore the full worktree: ${r.out}`);
}

// Brings the worktree in line with the task's stage. Returns a warning instead of throwing.
export function syncTestView(root, config, task) {
  if (!task.worktree) return null;
  const wt = resolve(root, task.worktree);
  try {
    if (task.stage === 'tests' && ISOLATED_STATUSES.has(task.status)) applyTestView(wt, config);
    else clearTestView(wt);
    return null;
  } catch (err) {
    return err.message;
  }
}
