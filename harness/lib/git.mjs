import { spawnSync } from 'node:child_process';
import { dirname, resolve, isAbsolute, join } from 'node:path';

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

const lines = (out) => (out ? out.split('\n').filter(Boolean) : []);

// The main worktree root, so agents in .worktrees/<id> still read and write the shared tasks/.
export function resolveRoot(cwd = process.cwd()) {
  if (process.env.DC_ROOT) return resolve(process.env.DC_ROOT);
  const common = git(cwd, ['rev-parse', '--git-common-dir']);
  if (!common) return resolve(cwd);
  const abs = isAbsolute(common) ? common : join(cwd, common);
  return dirname(resolve(abs));
}

// Files the task branch changed against base, plus uncommitted changes in its worktree.
export function changedFiles(root, { baseBranch, branch, worktree }) {
  const committed = branch && git(root, ['rev-parse', '--verify', '--quiet', branch]) !== null
    ? lines(git(root, ['diff', '--name-only', `${baseBranch}...${branch}`]))
    : [];
  const wtDir = worktree ? resolve(root, worktree) : null;
  const uncommitted = wtDir ? lines(git(wtDir, ['status', '--porcelain'])).map((l) => l.slice(3)) : [];
  return [...new Set([...committed, ...uncommitted])].sort();
}

const SLUG_MAX = 40;

export function slugify(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, SLUG_MAX) || 'task';
}

// Creates branch task/<id>-<slug> from base, checked out in .worktrees/<id>.
export function createTaskWorktree(root, { id, title, baseBranch }) {
  const branch = `task/${id}-${slugify(title)}`;
  const worktree = `.worktrees/${id}`;
  const r = spawnSync('git', ['worktree', 'add', '-q', '-b', branch, worktree, baseBranch], { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git worktree add failed: ${r.stderr.trim()}`);
  return { branch, worktree };
}
