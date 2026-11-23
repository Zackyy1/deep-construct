// Pure task state transitions. Every function returns a new task; inputs are never mutated.
import { planStages, upgradeStages, nextStage, defaultReturnStage } from './tracks.mjs';

const ACTIVE = new Set(['pending', 'in_progress', 'escalated']);

function assertActive(task) {
  if (!ACTIVE.has(task.status)) throw new Error(`task ${task.id} is not active (status: ${task.status})`);
}

function evolve(task, changes, entry, at) {
  return {
    ...task,
    ...changes,
    updatedAt: at,
    history: [...task.history, { at, stage: changes.stage ?? task.stage, ...entry }],
  };
}

function escalate(task, reason, at) {
  return evolve(task, { status: 'escalated', escalation: { reason, at } }, { event: 'escalated', note: reason }, at);
}

export function createTask({ id, title, track, skip = [], spec = null, branch = null, worktree = null, budgetUsd, at }) {
  const stages = planStages(track, skip);
  return {
    id, title, track, skip: [...skip], stages, stage: stages[0], status: 'pending', owner: null, round: 1,
    spec, branch, worktree, budget: { limitUsd: budgetUsd, spentUsd: 0 }, reports: [], escalation: null,
    createdAt: at, updatedAt: at,
    history: [{ at, event: 'created', stage: stages[0], note: `track=${track}` }],
  };
}

export function startTask(task, { owner, at }) {
  assertActive(task);
  if (task.status === 'escalated') throw new Error(`task ${task.id} is escalated; resolve it first`);
  return evolve(task, { status: 'in_progress', owner }, { event: 'started', by: owner }, at);
}

function resolveReturn(task, stage, returnTo) {
  const target = returnTo ?? defaultReturnStage(stage);
  const targetIdx = task.stages.indexOf(target);
  if (targetIdx === -1 || targetIdx > task.stages.indexOf(stage)) {
    throw new Error(`returnTo "${target}" must be this stage or an earlier stage of task ${task.id}`);
  }
  return target;
}

export function recordResult(task, { stage, verdict, returnTo, reportPath, reasons = [], maxRounds, at }) {
  assertActive(task);
  if (task.status === 'escalated') throw new Error(`task ${task.id} is escalated; resolve it first`);
  if (stage !== task.stage) throw new Error(`report is for "${stage}" but current stage is "${task.stage}"`);
  const reports = [...task.reports, reportPath];
  const note = reasons.join('; ') || undefined;

  if (verdict === 'pass') {
    const next = nextStage(task);
    if (!next) return evolve(task, { status: 'done', owner: null, reports }, { event: 'done', note }, at);
    return evolve(task, { stage: next, status: 'pending', owner: null, reports }, { event: `passed:${stage}`, note }, at);
  }

  const target = resolveReturn(task, stage, returnTo);
  const round = task.round + 1;
  const failed = evolve(task, { stage: target, status: 'pending', owner: null, round, reports }, { event: `failed:${stage}`, note }, at);
  return round > maxRounds ? escalate(failed, `exceeded ${maxRounds} rounds at ${stage}`, at) : failed;
}

export function upgradeTrack(task, { track, reason, budgetUsd, at }) {
  assertActive(task);
  const stages = upgradeStages(task, track);
  const limitUsd = Math.max(task.budget.limitUsd, budgetUsd ?? 0);
  return evolve(task, { track, stages, budget: { ...task.budget, limitUsd } },
    { event: 'track-upgraded', note: `${task.track} -> ${track}: ${reason}` }, at);
}

export function addSpend(task, { usd, at }) {
  assertActive(task);
  if (!(usd >= 0)) throw new Error('usd must be a non-negative number');
  const spentUsd = Math.round((task.budget.spentUsd + usd) * 10000) / 10000;
  const updated = evolve(task, { budget: { ...task.budget, spentUsd } }, { event: 'spend', note: `+$${usd}` }, at);
  const over = spentUsd > task.budget.limitUsd && task.status !== 'escalated';
  return over ? escalate(updated, `over budget: $${spentUsd} of $${task.budget.limitUsd}`, at) : updated;
}

export function resolveEscalation(task, { to, note, budgetUsd, at }) {
  if (task.status !== 'escalated') throw new Error(`task ${task.id} is not escalated`);
  if (!task.stages.includes(to)) throw new Error(`stage "${to}" is not part of task ${task.id}`);
  const limitUsd = budgetUsd ?? task.budget.limitUsd;
  return evolve(task, { stage: to, status: 'pending', owner: null, round: 1, escalation: null, budget: { ...task.budget, limitUsd } },
    { event: 'resolved', note }, at);
}

export function cancelTask(task, { note, at }) {
  assertActive(task);
  return evolve(task, { status: 'cancelled', owner: null }, { event: 'cancelled', note }, at);
}
