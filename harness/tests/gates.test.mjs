import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateGate } from '../lib/gates.mjs';

const report = (stage, extra = {}) => ({ taskId: 'T-0001', stage, role: 'x', round: 1, verdict: 'pass', summary: 's', ...extra });

test('review with a high finding fails even if the agent says pass', () => {
  const g = evaluateGate(report('review', { findings: [{ severity: 'high', issue: 'sql injection' }] }));
  assert.equal(g.verdict, 'fail');
  assert.equal(g.contradicted, true);
});

test('review with only medium/low findings passes', () => {
  const g = evaluateGate(report('review', { findings: [{ severity: 'medium', issue: 'naming' }] }));
  assert.equal(g.verdict, 'pass');
  assert.equal(g.contradicted, false);
});

test('an agent can always fail its own stage', () => {
  const g = evaluateGate(report('review', { verdict: 'fail', findings: [] }));
  assert.equal(g.verdict, 'fail');
  assert.equal(g.contradicted, false);
});

test('implementation gate reads exit codes, not the summary', () => {
  const checks = [{ name: 'test', exitCode: 1, outputTail: 'FAIL login.spec' }, { name: 'lint', exitCode: 0 }];
  const g = evaluateGate(report('implementation', { summary: 'all tests green' }), { checks });
  assert.equal(g.verdict, 'fail');
  assert.ok(g.reasons.some((r) => r.includes('test')));
});

test('implementation gate fails if checks were not run', () => {
  assert.equal(evaluateGate(report('implementation')).verdict, 'fail');
});

test('qa must pass every acceptance criterion in the spec', () => {
  const criteria = [{ id: 'AC-1', status: 'pass', evidence: 'shot.png' }];
  const g = evaluateGate(report('qa', { criteria }), { acIds: ['AC-1', 'AC-2'] });
  assert.equal(g.verdict, 'fail');
  assert.ok(g.reasons.some((r) => r.includes('AC-2')));
});

test('qa with a spec that has no criteria fails', () => {
  assert.equal(evaluateGate(report('qa', { criteria: [] }), { acIds: [] }).verdict, 'fail');
});

test('tests stage must cover every acceptance criterion', () => {
  const r = report('tests', { testFiles: ['a.test.ts'], criteriaCovered: ['AC-1'], command: 'npm test' });
  assert.equal(evaluateGate(r, { acIds: ['AC-1'] }).verdict, 'pass');
  assert.equal(evaluateGate(r, { acIds: ['AC-1', 'AC-3'] }).verdict, 'fail');
});

test('requirements gate needs at least one acceptance criterion', () => {
  assert.equal(evaluateGate(report('requirements'), { acIds: [] }).verdict, 'fail');
  assert.equal(evaluateGate(report('requirements'), { acIds: ['AC-1'] }).verdict, 'pass');
});

test('release fails while USER_TODO markers remain in code', () => {
  const g = evaluateGate(report('release'), { markerHits: [{ file: 'src/pay.ts', line: 3, text: 'USER_TODO #2' }] });
  assert.equal(g.verdict, 'fail');
});

test('askOrchestrator is accepted on any report', async () => {
  const { validateReport } = await import('../lib/schemas.mjs');
  assert.doesNotThrow(() => validateReport(report('architecture', { askOrchestrator: 'Is a queue overkill here?' })));
});
