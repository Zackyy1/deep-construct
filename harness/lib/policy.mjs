// Access policy enforced by .claude/hooks/guard.mjs. Pure functions: (role, path/command) -> { allow, reason }.
// Roles are agent names (dc-*); the main session is "orchestrator".
import { matchesGlob } from 'node:path';

export const ORCHESTRATOR = 'orchestrator';

const LOCKED = ['core/**', '.claude/**', 'harness/**', 'dc.config.json', 'CLAUDE.md', '.dc-maintainer'];
const CLI_ONLY = ['tasks/**', 'reports/archive/**', 'reports/usage.jsonl'];
const ROOT_ONLY = ['memory/**', 'specs/**', 'playbooks/**', 'context/**', 'tasks/**', 'reports/**', 'USER_TODO.md', 'CHANGELOG.md'];
const SHARED = ['memory/**', 'USER_TODO.md', 'reports/inbox/**', 'reports/evidence/**', 'specs/*/decisions.md'];

const ROLE_WRITES = Object.freeze({
  [ORCHESTRATOR]: [...SHARED, 'specs/**', 'playbooks/**', 'context/**', 'CHANGELOG.md'],
  'dc-requirements': [...SHARED, 'specs/**'],
  'dc-ux-lead': [...SHARED, 'specs/**'],
  'dc-architect': [...SHARED, 'specs/**'],
});

const WORKTREE_WRITERS = new Set(['dc-architect', 'dc-implementer', 'dc-test-engineer', 'dc-release', 'dc-docs', 'dc-fixer', 'dc-scribe']);
const TEST_ONLY_WRITERS = new Set(['dc-test-engineer']);
const NO_EXISTING_TEST_EDITS = new Set(['dc-implementer', 'dc-fixer']);

const TESTER = 'dc-test-engineer';
const TESTER_ROOT_READS = ['specs/**', 'memory/**', 'context/**', 'playbooks/**', 'core/**', 'reports/inbox/**', 'USER_TODO.md', 'dc.config.json', '**/node_modules/**'];

const allow = () => ({ allow: true });
const deny = (reason) => ({ allow: false, reason });
const matchAny = (path, globs = []) => globs.some((g) => matchesGlob(path, g));
const isOutside = (rel) => rel === '..' || rel.startsWith('../') || rel.startsWith('/');

export function splitWorktree(rel) {
  const m = /^\.worktrees\/([^/]+)(?:\/(.*))?$/.exec(rel);
  return m ? { taskDir: m[1], inner: m[2] ?? '' } : null;
}

// ---------- writes ----------

function decideWorktreeWrite(role, inner, exists, config) {
  if (matchAny(inner, LOCKED)) return deny(`${inner} is locked, also inside worktrees. Only the human owner changes it.`);
  if (matchAny(inner, ROOT_ONLY)) return deny(`${inner} is shared state. Write the copy in the project root, not in a worktree.`);
  if (!WORKTREE_WRITERS.has(role)) {
    return deny(role === ORCHESTRATOR
      ? 'The orchestrator does not write product code. Put the fix in your review for an implementer to apply.'
      : `${role} may not edit code.`);
  }
  const isTest = matchAny(inner, config.testPaths);
  if (TEST_ONLY_WRITERS.has(role) && !isTest) return deny(`The test engineer writes only test files (testPaths in dc.config.json). ${inner} is not one.`);
  if (NO_EXISTING_TEST_EDITS.has(role) && isTest && exists) {
    return deny('Existing tests belong to the test engineer. If a test is wrong, report fail with returnTo "tests" and quote it.');
  }
  return allow();
}

export function decideWrite({ role, rel, exists, config }) {
  if (isOutside(rel)) return role === ORCHESTRATOR ? allow() : deny(`${role} may not write outside the project (${rel}).`);
  if (matchAny(rel, LOCKED)) return deny(`${rel} is locked (core rules, harness, config). Only the human owner changes it.`);
  if (matchAny(rel, CLI_ONLY)) return deny(`${rel} is written only by harness/bin/task.mjs.`);
  const wt = splitWorktree(rel);
  if (wt) return decideWorktreeWrite(role, wt.inner, exists, config);
  const allowed = ROLE_WRITES[role] ?? SHARED;
  return matchAny(rel, allowed) ? allow() : deny(`${role} may not write ${rel}. Allowed: ${allowed.join(', ')}.`);
}

export function decidePlaybookSize({ rel, content, maxLines }) {
  if (!matchesGlob(rel, 'playbooks/*.md') || rel === 'playbooks/CHANGES.md') return allow();
  const lines = content.trimEnd().split('\n').length;
  return lines <= maxLines ? allow() : deny(`${rel} would be ${lines} lines; the cap is ${maxLines}. Merge or remove a rule first.`);
}

// ---------- reads (only the test engineer is restricted) ----------

export function testerReadable(config) {
  return [...config.testPaths, ...config.contractPaths, ...config.testSupportPaths, '**/node_modules/**'];
}

export function decideRead({ role, rel, kind = 'file', config }) {
  if (role !== TESTER || isOutside(rel)) return allow();
  const wt = splitWorktree(rel);
  if (wt) {
    if (kind === 'dir' || wt.inner === '' || matchAny(wt.inner, testerReadable(config))) return allow();
    return deny(`The test engineer reads only specs, contracts and tests. ${wt.inner} is implementation. If you need it, the contracts are incomplete: report that.`);
  }
  const probe = kind === 'dir' ? `${rel}/_` : rel;
  return matchAny(probe, TESTER_ROOT_READS) ? allow() : deny(`The test engineer may not read ${rel} in the project root. Use the spec and your worktree.`);
}

// ---------- shell ----------

const DESTRUCTIVE = [
  [/\brm\s+(?:-[a-zA-Z]+\s+)*-[a-zA-Z]*[rR][a-zA-Z]*\s+(?:-[a-zA-Z]+\s+)*(?:\/\*?|~\/?|\$HOME\/?|\.\.?\/?|\*)(?=\s|$|;|&|\|)/, 'recursive delete of /, ~, ., .. or *'],
  [/\bgit\b[^|;&]*\bpush\b[^|;&]*(?:--force(?:-with-lease)?\b|\s-f\b)/, 'force push'],
  [/\b(?:drop\s+(?:database|schema|table)|truncate\s+table)\b/i, 'dropping or truncating database objects'],
];
const HARD_RESET = /\bgit\b[^|;&]*\b(?:reset\s+--hard|clean\s+-[a-zA-Z]*f)/;
const LOCKED_TOKEN = /(?:^|[\s'"=/])(?:core\/|\.claude\/|harness\/|dc\.config\.json|CLAUDE\.md|tasks\/|reports\/archive\/|reports\/usage\.jsonl|\.dc-maintainer)/;
const WRITE_VERB = /^\s*(?:sudo\s+)?(?:sed\s+(?:-[a-zA-Z]*\s+)*-i|perl\s+-\w*i|mv|cp|rm|chmod|chown|truncate|ln|install|touch)\b/;
const REDIRECT_TARGET = /(?:>{1,2}|\btee\s+(?:-a\s+)?)\s*['"]?([^\s'"|;&]+)/g;
const GIT_PUSH = /\bgit\b[^|;&]*\bpush\b/;
const TASK_MUTATION = /task\.mjs\s+(?:create|start|submit|upgrade|spend|resolve|cancel)\b/;
const GIT_PEEK = /\bgit\b[^|;&]*\b(?:show|cat-file|archive|sparse-checkout|restore\s+[^|;&]*--source|log\s+[^|;&]*-p\b|log\s+-p\b|diff\s+[^|;&]*\.\.|checkout\s+\S+\s+--\s)/;
const ABS_PATH = /(?:^|[\s'"=])(\/[^\s'";|&)]+)/g;

const segments = (command) => command.split(/\|\||&&|[|;&\n]/);

function writesLocked(command) {
  if (segments(command).some((s) => WRITE_VERB.test(s) && LOCKED_TOKEN.test(s))) return true;
  return [...command.matchAll(REDIRECT_TARGET)].some((m) => LOCKED_TOKEN.test(` ${m[1]}`));
}

function inWorktree(command, cwd, root) {
  return cwd.startsWith(`${root}/.worktrees/`) || command.includes('.worktrees/');
}

function testerShellProblem(command, root) {
  if (GIT_PEEK.test(command)) return 'The test engineer may not read other revisions or change the sparse view through git.';
  if (command.includes('../')) return 'The test engineer may not use ../ paths. Use absolute paths to specs or your worktree.';
  for (const [, path] of command.matchAll(ABS_PATH)) {
    if (!path.startsWith(`${root}/`)) continue;
    const rel = path.slice(root.length + 1);
    if (!rel.startsWith('.worktrees/') && !matchAny(rel, TESTER_ROOT_READS) && !matchAny(`${rel}/_`, TESTER_ROOT_READS)) {
      return `The test engineer may not touch ${rel} in the project root.`;
    }
  }
  return null;
}

export function decideBash({ role, command, cwd, root }) {
  for (const [re, what] of DESTRUCTIVE) if (re.test(command)) return deny(`Blocked: ${what}. Needs the human owner.`);
  if (HARD_RESET.test(command) && !inWorktree(command, cwd, root)) {
    return deny('git reset --hard / git clean -f are allowed only inside a task worktree.');
  }
  if (writesLocked(command)) return deny('Blocked: this command writes to a locked path (core/, .claude/, harness/, dc.config.json, CLAUDE.md, tasks/, reports/archive/).');
  if (role !== ORCHESTRATOR) {
    if (GIT_PUSH.test(command)) return deny('Only the orchestrator pushes.');
    if (TASK_MUTATION.test(command)) return deny('Only the orchestrator changes task state. Write your report; the orchestrator submits it.');
  }
  if (role === TESTER) {
    const problem = testerShellProblem(command, root);
    if (problem) return deny(problem);
  }
  return allow();
}

// ---------- sparse view for the test engineer ----------

export function toSparsePattern(glob) {
  const anywhere = glob.startsWith('**/');
  const body = anywhere ? glob.slice(3) : glob;
  const dir = body.endsWith('/**') ? `${body.slice(0, -3)}/` : body;
  return anywhere ? dir : `/${dir}`;
}
