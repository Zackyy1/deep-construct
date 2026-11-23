import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideWrite, decideRead, decideBash, decidePlaybookSize, toSparsePattern } from '../lib/policy.mjs';

const config = {
  testPaths: ['**/*.test.*', '**/*.spec.*', 'tests/**', '**/tests/**', '**/e2e/**'],
  contractPaths: ['**/types/**', '**/contracts/**', '**/*.d.ts'],
  testSupportPaths: ['package.json', 'tsconfig*.json', '*.config.*'],
  playbookMaxLines: 5,
};
const ROOT = '/proj';
const w = (role, rel, exists = false) => decideWrite({ role, rel, exists, config });
const b = (role, command, cwd = ROOT) => decideBash({ role, command, cwd, root: ROOT });

test('locked paths are denied to every role, including inside worktrees', () => {
  for (const rel of ['core/RULES.md', '.claude/settings.json', 'harness/lib/gates.mjs', 'dc.config.json', 'CLAUDE.md', '.worktrees/T-0001/core/RULES.md']) {
    assert.equal(w('orchestrator', rel).allow, false, rel);
    assert.equal(w('dc-implementer', rel).allow, false, rel);
  }
});

test('task state and archived reports are written only by the CLI', () => {
  assert.equal(w('orchestrator', 'tasks/T-0001.json').allow, false);
  assert.equal(w('orchestrator', 'reports/archive/T-0001/review-r1.json').allow, false);
});

test('everyone can write shared memory, USER_TODO and the report inbox', () => {
  for (const role of ['orchestrator', 'dc-code-reviewer', 'dc-qa-tester', 'some-other-agent']) {
    assert.equal(w(role, 'memory/caveats.md').allow, true, role);
    assert.equal(w(role, 'USER_TODO.md').allow, true, role);
    assert.equal(w(role, 'reports/inbox/T-0001-review-r1.json').allow, true, role);
  }
});

test('the orchestrator writes specs and playbooks but never product code', () => {
  assert.equal(w('orchestrator', 'playbooks/dc-implementer.md').allow, true);
  assert.equal(w('orchestrator', 'specs/login/requirements.md').allow, true);
  assert.equal(w('orchestrator', 'src/app.ts').allow, false);
  assert.equal(w('orchestrator', '.worktrees/T-0001/src/app.ts').allow, false);
});

test('only the orchestrator edits playbooks', () => {
  assert.equal(w('dc-implementer', 'playbooks/dc-implementer.md').allow, false);
});

test('reviewers cannot edit code', () => {
  assert.equal(w('dc-code-reviewer', '.worktrees/T-0001/src/app.ts').allow, false);
  assert.equal(w('dc-security-reviewer', 'src/app.ts').allow, false);
});

test('implementers write code only inside a worktree', () => {
  assert.equal(w('dc-implementer', '.worktrees/T-0001/src/app.ts').allow, true);
  assert.equal(w('dc-implementer', 'src/app.ts').allow, false);
});

test('implementers cannot edit existing tests but may add new ones', () => {
  assert.equal(w('dc-implementer', '.worktrees/T-0001/src/a.test.ts', true).allow, false);
  assert.equal(w('dc-fixer', '.worktrees/T-0001/tests/x.ts', true).allow, false);
  assert.equal(w('dc-implementer', '.worktrees/T-0001/src/helper.test.ts', false).allow, true);
});

test('without a tests stage the implementer owns the tests and may edit them', () => {
  const r = decideWrite({ role: 'dc-implementer', rel: '.worktrees/T-0001/src/a.test.ts', exists: true, config, engineerOwnsTests: false });
  assert.equal(r.allow, true);
});

test('the test engineer writes only test files', () => {
  assert.equal(w('dc-test-engineer', '.worktrees/T-0001/tests/login.spec.ts').allow, true);
  assert.equal(w('dc-test-engineer', '.worktrees/T-0001/src/app.ts').allow, false);
});

test('shared state is never written inside a worktree', () => {
  assert.equal(w('dc-implementer', '.worktrees/T-0001/memory/caveats.md').allow, false);
  assert.equal(w('dc-implementer', '.worktrees/T-0001/specs/x/ux.md').allow, false);
});

test('subagents cannot write outside the project', () => {
  assert.equal(w('dc-implementer', '../elsewhere/x.ts').allow, false);
});

test('the test engineer reads specs, tests and contracts but not implementation', () => {
  const r = (rel) => decideRead({ role: 'dc-test-engineer', rel, config }).allow;
  assert.equal(r('specs/login/requirements.md'), true);
  assert.equal(r('.worktrees/T-0001/src/types/user.ts'), true);
  assert.equal(r('.worktrees/T-0001/tests/a.test.ts'), true);
  assert.equal(r('.worktrees/T-0001/package.json'), true);
  assert.equal(r('.worktrees/T-0001/src/app.ts'), false);
  assert.equal(r('src/app.ts'), false);
  assert.equal(r('.'), false);
});

test('other roles read anything', () => {
  assert.equal(decideRead({ role: 'dc-implementer', rel: 'src/app.ts', config }).allow, true);
});

test('destructive commands are denied for everyone', () => {
  for (const cmd of ['rm -rf /', 'rm -rf ~', 'rm -fr ..', 'git push --force origin main', 'git push -f', 'psql -c "DROP DATABASE prod"', 'git reset --hard HEAD~3']) {
    assert.equal(b('orchestrator', cmd).allow, false, cmd);
  }
});

test('git reset --hard is allowed inside a task worktree', () => {
  assert.equal(b('dc-implementer', 'git reset --hard HEAD', '/proj/.worktrees/T-0001').allow, true);
  assert.equal(b('dc-implementer', 'git -C .worktrees/T-0001 reset --hard HEAD').allow, true);
});

test('shell writes to locked paths are denied', () => {
  for (const cmd of ['echo x > core/RULES.md', "sed -i '' 's/a/b/' dc.config.json", 'cat a | tee .claude/settings.json', 'rm tasks/T-0001.json', 'cp x .worktrees/T-0001/harness/lib/gates.mjs']) {
    assert.equal(b('dc-implementer', cmd).allow, false, cmd);
  }
});

test('reading locked paths from the shell is fine', () => {
  assert.equal(b('dc-implementer', 'cat core/RULES.md').allow, true);
  assert.equal(b('dc-implementer', 'node harness/bin/task.mjs show T-0001').allow, true);
});

test('subagents cannot push or change task state; the orchestrator can', () => {
  assert.equal(b('dc-implementer', 'git push origin task/T-0001').allow, false);
  assert.equal(b('dc-implementer', 'node harness/bin/task.mjs submit T-0001 --report x').allow, false);
  assert.equal(b('orchestrator', 'node harness/bin/task.mjs submit T-0001 --report x').allow, true);
});

test('the test engineer cannot read implementation through git or paths outside its worktree', () => {
  const cwd = '/proj/.worktrees/T-0001';
  for (const cmd of ['git show HEAD:src/app.ts', 'git cat-file -p HEAD:src/app.ts', 'git log -p', 'git sparse-checkout disable', 'cat ../../src/app.ts', 'cat /proj/src/app.ts']) {
    assert.equal(b('dc-test-engineer', cmd, cwd).allow, false, cmd);
  }
  assert.equal(b('dc-test-engineer', 'npx vitest run tests/', cwd).allow, true);
  assert.equal(b('dc-test-engineer', 'cat /proj/specs/login/requirements.md', cwd).allow, true);
  assert.equal(b('dc-test-engineer', 'git add tests && git commit -m "test: AC-1"', cwd).allow, true);
});

test('playbooks over the line cap are rejected', () => {
  assert.equal(decidePlaybookSize({ rel: 'playbooks/dc-implementer.md', content: '1\n2\n3', maxLines: 5 }).allow, true);
  assert.equal(decidePlaybookSize({ rel: 'playbooks/dc-implementer.md', content: '1\n2\n3\n4\n5\n6', maxLines: 5 }).allow, false);
  assert.equal(decidePlaybookSize({ rel: 'playbooks/CHANGES.md', content: '1\n2\n3\n4\n5\n6', maxLines: 5 }).allow, true);
});

test('globs convert to sparse-checkout patterns', () => {
  assert.equal(toSparsePattern('**/*.test.*'), '*.test.*');
  assert.equal(toSparsePattern('**/types/**'), 'types/');
  assert.equal(toSparsePattern('tests/**'), '/tests/');
  assert.equal(toSparsePattern('package.json'), '/package.json');
});
