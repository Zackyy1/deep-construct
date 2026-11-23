import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTask, startTask, recordResult, upgradeTrack, addSpend, resolveEscalation, cancelTask,
} from '../lib/transitions.mjs';

const AT = '2026-11-23T10:00:00.000Z';
const base = () => createTask({ id: 'T-0001', title: 'Login form', track: 'trivial', budgetUsd: 1, at: AT });

test('createTask starts at the first stage, pending, round 1', () => {
  const t = base();
  assert.equal(t.stage, 'implementation');
  assert.equal(t.status, 'pending');
  assert.equal(t.round, 1);
  assert.equal(t.history.length, 1);
});

test('transitions never mutate the input task', () => {
  const t = Object.freeze(base());
  const started = startTask(t, { owner: 'implementer', at: AT });
  assert.equal(t.status, 'pending');
  assert.equal(started.status, 'in_progress');
  assert.equal(started.owner, 'implementer');
});

test('pass moves to the next stage and clears the owner', () => {
  const t = recordResult(startTask(base(), { owner: 'implementer', at: AT }),
    { stage: 'implementation', verdict: 'pass', reportPath: 'r1', maxRounds: 3, at: AT });
  assert.equal(t.stage, 'review');
  assert.equal(t.status, 'pending');
  assert.equal(t.owner, null);
  assert.deepEqual(t.reports, ['r1']);
});

test('pass on the last stage marks the task done', () => {
  let t = { ...base(), stage: 'signoff' };
  t = recordResult(t, { stage: 'signoff', verdict: 'pass', reportPath: 'r', maxRounds: 3, at: AT });
  assert.equal(t.status, 'done');
});

test('fail returns to the default stage and increments the round', () => {
  let t = { ...base(), stage: 'review' };
  t = recordResult(t, { stage: 'review', verdict: 'fail', reportPath: 'r', maxRounds: 3, at: AT });
  assert.equal(t.stage, 'implementation');
  assert.equal(t.round, 2);
});

test('failing past maxRounds escalates', () => {
  let t = { ...base(), stage: 'review', round: 3 };
  t = recordResult(t, { stage: 'review', verdict: 'fail', reportPath: 'r', maxRounds: 3, at: AT });
  assert.equal(t.status, 'escalated');
  assert.match(t.escalation.reason, /rounds/);
});

test('returnTo must be an earlier stage of this task', () => {
  const t = { ...base(), stage: 'review' };
  assert.throws(() => recordResult(t, { stage: 'review', verdict: 'fail', returnTo: 'signoff', reportPath: 'r', maxRounds: 3, at: AT }), /returnTo/);
  assert.throws(() => recordResult(t, { stage: 'review', verdict: 'fail', returnTo: 'qa', reportPath: 'r', maxRounds: 3, at: AT }), /returnTo/);
});

test('result for the wrong stage is rejected', () => {
  assert.throws(() => recordResult(base(), { stage: 'review', verdict: 'pass', reportPath: 'r', maxRounds: 3, at: AT }), /current stage/);
});

test('upgradeTrack raises the track, stages and budget', () => {
  const t = upgradeTrack(base(), { track: 'risky', reason: 'touches auth/', budgetUsd: 20, at: AT });
  assert.equal(t.track, 'risky');
  assert.ok(t.stages.includes('security'));
  assert.equal(t.budget.limitUsd, 20);
});

test('spending over budget escalates', () => {
  const t = addSpend(base(), { usd: 1.5, at: AT });
  assert.equal(t.status, 'escalated');
  assert.match(t.escalation.reason, /budget/);
});

test('resolveEscalation resets the round and sets the stage', () => {
  const escalated = addSpend(base(), { usd: 5, at: AT });
  const t = resolveEscalation(escalated, { to: 'implementation', note: 'raised budget', budgetUsd: 10, at: AT });
  assert.equal(t.status, 'pending');
  assert.equal(t.round, 1);
  assert.equal(t.escalation, null);
  assert.equal(t.budget.limitUsd, 10);
});

test('done and cancelled tasks cannot change', () => {
  const cancelled = cancelTask(base(), { note: 'dup', at: AT });
  assert.throws(() => startTask(cancelled, { owner: 'x', at: AT }), /not active/);
});
