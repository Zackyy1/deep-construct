import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { initProject, TEMPLATE_PATHS } from '../lib/init.mjs';

const GIT_ENV = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
Object.assign(process.env, GIT_ENV);

function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}

function write(root, rel, content) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}

function fakeEngine() {
  const root = mkdtempSync(join(tmpdir(), 'dc-engine-'));
  write(root, 'harness/package.json', JSON.stringify({ name: 'deep-construct', version: '9.8.7' }));
  write(root, 'harness/lib/a.mjs', 'export {};\n');
  write(root, 'dc.config.json', JSON.stringify({ baseBranch: 'main', maxRounds: 3 }));
  write(root, 'core/RULES.md', '# rules\n');
  write(root, 'CLAUDE.md', '# engine\n');
  write(root, '.gitignore', 'tasks/*.json\n');
  write(root, 'tasks/.gitkeep', '');
  write(root, 'office/server.mjs', '// IDE, not part of the template\n');
  for (const rel of TEMPLATE_PATHS) {
    if (existsSync(join(root, rel))) continue;
    write(root, /\.\w+$/.test(rel) ? rel : `${rel}/placeholder.md`, '');
  }
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'engine');
  git(root, 'commit', '-q', '--allow-empty', '-m', 'second engine commit');
  write(root, 'tasks/T-0001.json', '{}');
  return root;
}

const freshTarget = () => join(mkdtempSync(join(tmpdir(), 'dc-target-')), 'my-app');

test('copies the engine template into a fresh repo with a single commit', () => {
  const source = fakeEngine();
  const target = freshTarget();

  initProject({ source, target });

  assert.ok(existsSync(join(target, 'core/RULES.md')));
  assert.ok(existsSync(join(target, 'harness/lib/a.mjs')));
  assert.ok(existsSync(join(target, 'tasks/.gitkeep')));
  assert.ok(!existsSync(join(target, 'office')), 'the office IDE is not copied');
  assert.ok(!existsSync(join(target, 'tasks/T-0001.json')), 'local state is not copied');
  assert.equal(git(target, 'rev-list', '--count', 'HEAD'), '1', 'engine history is not carried over');
  assert.equal(git(target, 'branch', '--show-current'), 'main');
  assert.equal(git(target, 'remote'), '', 'no remote points back at the engine');
  assert.equal(git(target, 'status', '--porcelain'), '');
});

test('stamps the engine version and commit into dc.config.json', () => {
  const source = fakeEngine();
  const target = freshTarget();
  const now = new Date('2026-11-23T10:00:00Z');

  const { engine } = initProject({ source, target, now });

  const config = JSON.parse(readFileSync(join(target, 'dc.config.json'), 'utf8'));
  assert.deepEqual(config.engine, { version: '9.8.7', commit: git(source, 'rev-parse', 'HEAD'), createdAt: now.toISOString() });
  assert.equal(config.maxRounds, 3, 'existing settings are kept');
  assert.equal(engine.version, '9.8.7');
  assert.match(git(target, 'log', '-1', '--format=%s'), /deep-construct 9\.8\.7 \([0-9a-f]{7}\)/);
});

test('copies only what is committed and reports uncommitted engine changes', () => {
  const source = fakeEngine();
  write(source, 'core/RULES.md', '# edited but not committed\n');
  const target = freshTarget();

  const { engine } = initProject({ source, target });

  assert.equal(readFileSync(join(target, 'core/RULES.md'), 'utf8'), '# rules\n');
  assert.equal(engine.dirty, true);
});

test('refuses a non-empty target', () => {
  const source = fakeEngine();
  const target = freshTarget();
  write(target, 'existing.txt', 'keep me');

  assert.throws(() => initProject({ source, target }), /not empty/);
  assert.equal(readFileSync(join(target, 'existing.txt'), 'utf8'), 'keep me');
});

test('refuses a target inside the engine repo', () => {
  const source = fakeEngine();

  assert.throws(() => initProject({ source, target: join(source, 'apps/x') }), /inside the engine repo/);
});
