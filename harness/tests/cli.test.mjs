import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'task.mjs');

function sh(cwd, cmd) {
  const r = spawnSync(cmd, { cwd, shell: true, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
}

function setupRepo({ checkCommand = 'node -e 0' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'dc-cli-'));
  writeFileSync(join(root, 'dc.config.json'), JSON.stringify({
    baseBranch: 'main', maxRounds: 2, checks: { test: checkCommand },
    budgetsUsd: { trivial: 1, standard: 8, risky: 20 }, riskyPaths: ['**/auth/**'],
  }));
  writeFileSync(join(root, '.gitignore'), 'tasks/\nreports/\n');
  sh(root, 'git init -q -b main && git add . && git -c user.email=t@t -c user.name=t commit -q -m init');
  return root;
}

function cli(root, args) {
  const r = spawnSync('node', [CLI, ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, DC_ROOT: root } });
  return { code: r.status, out: r.stdout, err: r.stderr, json: r.stdout ? JSON.parse(r.stdout) : null };
}

function writeReport(root, name, report) {
  mkdirSync(join(root, 'reports/inbox'), { recursive: true });
  const path = join(root, 'reports/inbox', name);
  writeFileSync(path, JSON.stringify(report));
  return path;
}

const implReport = (round = 1) => ({ taskId: 'T-0001', stage: 'implementation', role: 'implementer', round, verdict: 'pass', summary: 'done' });

test('create assigns T-0001 and persists state', () => {
  const root = setupRepo();
  const r = cli(root, ['create', '--title', 'Login', '--track', 'trivial']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.id, 'T-0001');
  assert.ok(existsSync(join(root, 'tasks/T-0001.json')));
  assert.equal(cli(root, ['create', '--title', 'Second', '--track', 'trivial']).json.id, 'T-0002');
});

test('submit auto-upgrades to risky when the branch touches auth, then advances', () => {
  const root = setupRepo();
  cli(root, ['create', '--title', 'Tweak', '--track', 'trivial', '--branch', 'task/T-0001']);
  sh(root, 'git checkout -q -b task/T-0001 && mkdir -p src/auth && echo x > src/auth/a.ts && git add . && git -c user.email=t@t -c user.name=t commit -q -m wip && git checkout -q main');
  const r = cli(root, ['submit', 'T-0001', '--report', writeReport(root, 'impl.json', implReport())]);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.task.track, 'risky');
  assert.equal(r.json.task.stage, 'review');
  assert.deepEqual(r.json.gate.riskyFiles, ['src/auth/a.ts']);
  assert.ok(!existsSync(join(root, 'reports/inbox/impl.json')), 'inbox report is moved');
  const archived = JSON.parse(readFileSync(join(root, r.json.task.reports[0]), 'utf8'));
  assert.equal(archived.gate.verdict, 'pass');
  assert.equal(archived.gate.checks[0].exitCode, 0);
});

test('failing checks fail the gate with exit 1, and repeated failure escalates with exit 3', () => {
  const root = setupRepo({ checkCommand: 'node -e "console.log(\'FAIL login.spec\');process.exit(1)"' });
  cli(root, ['create', '--title', 'X', '--track', 'trivial']);
  const first = cli(root, ['submit', 'T-0001', '--report', writeReport(root, 'a.json', implReport(1))]);
  assert.equal(first.code, 1);
  assert.equal(first.json.task.round, 2);
  assert.match(first.json.gate.checks[0].outputTail, /FAIL login.spec/);
  const second = cli(root, ['submit', 'T-0001', '--report', writeReport(root, 'b.json', implReport(2))]);
  assert.equal(second.code, 3);
  assert.equal(second.json.task.status, 'escalated');
});

const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

test('a report written before the stage was last started is stale and rejected', () => {
  const root = setupRepo();
  cli(root, ['create', '--title', 'X', '--track', 'trivial']);
  const path = writeReport(root, 's.json', implReport(1));
  pause(30);
  cli(root, ['start', 'T-0001', '--owner', 'dc-implementer']);
  const stale = cli(root, ['submit', 'T-0001', '--report', path]);
  assert.equal(stale.code, 2);
  assert.match(stale.err, /stale/);
});

test('a fresh report with the wrong round is accepted and its round corrected', () => {
  const root = setupRepo();
  cli(root, ['create', '--title', 'X', '--track', 'trivial']);
  const r = cli(root, ['submit', 'T-0001', '--report', writeReport(root, 'w.json', implReport(5))]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.json.warnings[0], /recorded as round 1/);
  const archived = JSON.parse(readFileSync(join(root, r.json.task.reports[0]), 'utf8'));
  assert.equal(archived.report.round, 1);
});

test('starting a task that is already in progress needs --takeover', () => {
  const root = setupRepo();
  cli(root, ['create', '--title', 'X', '--track', 'trivial']);
  assert.equal(cli(root, ['start', 'T-0001', '--owner', 'dc-implementer']).code, 0);
  const again = cli(root, ['start', 'T-0001', '--owner', 'dc-implementer']);
  assert.equal(again.code, 2);
  assert.match(again.err, /already in progress/);
  const taken = cli(root, ['start', 'T-0001', '--owner', 'dc-implementer', '--takeover']);
  assert.equal(taken.code, 0, taken.err);
  assert.equal(taken.json.history.at(-1).event, 'taken-over');
});

test('standard tasks need a size, and requirements over the AC budget fail the gate', () => {
  const root = setupRepo();
  assert.match(cli(root, ['create', '--title', 'X', '--track', 'standard']).err, /--size is required/);
  const created = cli(root, ['create', '--title', 'X', '--track', 'standard', '--size', 'small', '--spec', 'specs/f']);
  assert.equal(created.code, 0, created.err);
  mkdirSync(join(root, 'specs/f'), { recursive: true });
  const acs = Array.from({ length: 9 }, (_, i) => `- AC-${i + 1}: x`).join('\n');
  writeFileSync(join(root, 'specs/f/requirements.md'), acs);
  const report = { taskId: 'T-0001', stage: 'requirements', role: 'x', round: 1, verdict: 'pass', summary: 's' };
  const r = cli(root, ['submit', 'T-0001', '--report', writeReport(root, 'r.json', report)]);
  assert.equal(r.code, 1);
  assert.match(r.json.gate.reasons[0], /budget of 8/);
});

test('invalid reports are rejected with exit 2 and change nothing', () => {
  const root = setupRepo();
  cli(root, ['create', '--title', 'X', '--track', 'trivial']);
  const bad = cli(root, ['submit', 'T-0001', '--report', writeReport(root, 'b.json', { taskId: 'T-0001' })]);
  assert.equal(bad.code, 2);
  assert.equal(cli(root, ['show', 'T-0001']).json.round, 1);
});

test('spend over budget escalates', () => {
  const root = setupRepo();
  cli(root, ['create', '--title', 'X', '--track', 'trivial']);
  const r = cli(root, ['spend', 'T-0001', '--usd', '2']);
  assert.equal(r.code, 3);
  assert.equal(r.json.status, 'escalated');
});

test('create --git makes a task branch and worktree from the base branch', () => {
  const root = setupRepo();
  const r = cli(root, ['create', '--title', 'Login Form!', '--track', 'trivial', '--git']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.branch, 'task/T-0001-login-form');
  assert.equal(r.json.worktree, '.worktrees/T-0001');
  assert.ok(existsSync(join(root, '.worktrees/T-0001')));
});

test('create --git with an explicit --branch is rejected', () => {
  const root = setupRepo();
  const r = cli(root, ['create', '--title', 'X', '--track', 'trivial', '--git', '--branch', 'b']);
  assert.equal(r.code, 2);
  assert.ok(!existsSync(join(root, 'tasks/T-0001.json')));
});

test('the tests stage hides implementation files in the worktree and restores them afterwards', () => {
  const root = setupRepo();
  sh(root, 'mkdir -p src/types tests && echo impl > src/app.ts && echo "export type U = {}" > src/types/u.ts && echo t > tests/a.test.ts && git add . && git -c user.email=t@t -c user.name=t commit -qm app');
  const created = cli(root, ['create', '--title', 'Feature', '--track', 'standard', '--size', 'medium', '--with', 'tests', '--skip', 'ux,release,docs', '--spec', 'specs/f', '--git']);
  assert.equal(created.code, 0, created.err);
  mkdirSync(join(root, 'specs/f'), { recursive: true });
  writeFileSync(join(root, 'specs/f/requirements.md'), '- AC-1: works');
  const wt = join(root, '.worktrees/T-0001');
  const generic = (stage) => ({ taskId: 'T-0001', stage, role: 'x', round: 1, verdict: 'pass', summary: 's' });
  assert.equal(cli(root, ['submit', 'T-0001', '--report', writeReport(root, 'r.json', generic('requirements'))]).code, 0);
  assert.equal(cli(root, ['submit', 'T-0001', '--report', writeReport(root, 'a.json', generic('architecture'))]).code, 0);

  const started = cli(root, ['start', 'T-0001', '--owner', 'dc-test-engineer']);
  assert.equal(started.code, 0, started.err);
  assert.ok(!existsSync(join(wt, 'src/app.ts')), 'implementation hidden');
  assert.ok(existsSync(join(wt, 'src/types/u.ts')), 'contracts visible');
  assert.ok(existsSync(join(wt, 'tests/a.test.ts')), 'tests visible');

  const testsReport = { ...generic('tests'), testFiles: ['tests/a.test.ts'], criteriaCovered: ['AC-1'], command: 'npm test' };
  const passed = cli(root, ['submit', 'T-0001', '--report', writeReport(root, 't.json', testsReport)]);
  assert.equal(passed.code, 0, passed.err);
  assert.equal(passed.json.task.stage, 'implementation');
  assert.ok(existsSync(join(wt, 'src/app.ts')), 'implementation restored');
});

test('usage summarises the usage log by task, agent and model', () => {
  const root = setupRepo();
  mkdirSync(join(root, 'reports'), { recursive: true });
  const entry = (taskId, agentType, usd) => JSON.stringify({ taskId, agentType, usd, byModel: { 'claude-haiku-5-5': { input: 1, output: 2, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 } } });
  writeFileSync(join(root, 'reports/usage.jsonl'), [entry('T-0001', 'dc-scout', 0.5), entry('T-0002', 'dc-scout', 0.25), ''].join('\n'));
  const all = cli(root, ['usage']).json;
  assert.equal(all.totalUsd, 0.75);
  assert.deepEqual(all.byAgent, { 'dc-scout': 0.75 });
  assert.equal(all.tokensByModel['claude-haiku-5-5'].output, 4);
  assert.equal(cli(root, ['usage', 'T-0002']).json.totalUsd, 0.25);
});
