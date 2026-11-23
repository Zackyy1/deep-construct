import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planStages, upgradeStages, nextStage, defaultReturnStage } from '../lib/tracks.mjs';

test('trivial track is implementation, review, signoff', () => {
  assert.deepEqual(planStages('trivial', []), ['implementation', 'review', 'signoff']);
});

test('standard track drops allowed skips', () => {
  const stages = planStages('standard', ['ux', 'release']);
  assert.ok(!stages.includes('ux'));
  assert.ok(!stages.includes('release'));
  assert.equal(stages[0], 'requirements');
  assert.equal(stages.at(-1), 'signoff');
});

test('skipping a non-skippable stage throws', () => {
  assert.throws(() => planStages('risky', ['security']), /cannot skip/);
  assert.throws(() => planStages('trivial', ['review']), /cannot skip/);
});

test('unknown track throws', () => {
  assert.throws(() => planStages('yolo', []), /unknown track/);
});

test('upgrade keeps finished stages and inserts the stricter track after the current stage', () => {
  const task = { track: 'trivial', skip: [], stages: ['implementation', 'review', 'signoff'], stage: 'implementation' };
  const stages = upgradeStages(task, 'risky');
  assert.deepEqual(stages, ['implementation', 'review', 'security', 'qa', 'release', 'docs', 'signoff']);
});

test('upgrade cannot go to a lower or equal track', () => {
  const task = { track: 'risky', skip: [], stages: planStages('risky', []), stage: 'review' };
  assert.throws(() => upgradeStages(task, 'standard'), /only upgrade/);
});

test('nextStage returns null after the last stage', () => {
  assert.equal(nextStage({ stages: ['review', 'signoff'], stage: 'review' }), 'signoff');
  assert.equal(nextStage({ stages: ['review', 'signoff'], stage: 'signoff' }), null);
});

test('review, security, qa and signoff failures go back to implementation', () => {
  for (const stage of ['review', 'security', 'qa', 'signoff']) {
    assert.equal(defaultReturnStage(stage), 'implementation');
  }
  assert.equal(defaultReturnStage('requirements'), 'requirements');
  assert.equal(defaultReturnStage('release'), 'release');
});
