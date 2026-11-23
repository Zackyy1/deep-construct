// Submitting a handoff report: validate it, auto-upgrade the track if the diff is risky,
// run the machine gate, archive the report with the gate result, then advance the task.
import { resolve } from 'node:path';
import { statSync } from 'node:fs';
import { readJson, readTask, writeTask, archivePathFor, archiveReport } from './store.mjs';
import { validateReport } from './schemas.mjs';
import { upgradeTrack, recordResult } from './transitions.mjs';
import { evaluateGate } from './gates.mjs';
import { riskyMatches } from './risk.mjs';
import { acceptanceCriteria } from './spec.mjs';
import { runChecks } from './checks.mjs';
import { scanMarkers } from './markers.mjs';
import { changedFiles } from './git.mjs';

const SUBMITTABLE = new Set(['pending', 'in_progress']);

// The last time the current stage was started. A report written before it belongs to an earlier run.
function stageStartedAt(task) {
  const started = task.history.filter((h) => h.stage === task.stage && (h.event === 'started' || h.event === 'taken-over'));
  return started.length ? Date.parse(started.at(-1).at) : null;
}

// Round numbers drift (rework elsewhere, escalation resets), so staleness is judged by time, not round.
// A fresh report with the wrong round is accepted and its round corrected, with a warning.
function reconcileRound(report, task, reportPath) {
  const startedAt = stageStartedAt(task);
  if (startedAt !== null && statSync(reportPath).mtimeMs < startedAt) {
    throw new Error(`report ${reportPath} was written before ${task.stage} was last started (stale report from an earlier run?)`);
  }
  if (report.round === task.round) return { report, warnings: [] };
  return {
    report: { ...report, round: task.round },
    warnings: [`report said round ${report.round}; recorded as round ${task.round}, the task's current round`],
  };
}

function assertMatchesTask(report, task) {
  if (task.status === 'escalated') {
    throw new Error(`task ${task.id} is escalated (${task.escalation?.reason}); resolve it before submitting`);
  }
  if (!SUBMITTABLE.has(task.status)) throw new Error(`task ${task.id} is ${task.status}; nothing to submit`);
  if (report.taskId !== task.id) throw new Error(`report is for ${report.taskId}, not ${task.id}`);
  if (report.stage !== task.stage) throw new Error(`report stage "${report.stage}" does not match current stage "${task.stage}"`);
}

function autoUpgrade(task, riskyFiles, config, at) {
  if (riskyFiles.length === 0 || task.track === 'risky') return task;
  const reason = `diff touches risky paths: ${riskyFiles.slice(0, 5).join(', ')}`;
  return upgradeTrack(task, { track: 'risky', reason, budgetUsd: config.budgetsUsd.risky, at });
}

function gateContext(root, config, task) {
  const workDir = resolve(root, task.worktree ?? config.appDir);
  const ctx = { acIds: acceptanceCriteria(root, task.spec), acBudget: config.acBudget?.[task.size] };
  if (task.stage === 'implementation') ctx.checks = runChecks(config.checks, workDir, config.checkTimeoutMs);
  if (task.stage === 'release') ctx.markerHits = scanMarkers(workDir, config.markerScanDirs, config.userTodoMarker);
  return ctx;
}

export function submitReport(root, config, { id, reportPath, at }) {
  const original = readTask(root, id);
  const submitted = validateReport(readJson(reportPath, 'report'));
  assertMatchesTask(submitted, original);
  const { report, warnings } = reconcileRound(submitted, original, reportPath);

  const files = changedFiles(root, { baseBranch: config.baseBranch, branch: original.branch, worktree: original.worktree });
  const riskyFiles = riskyMatches(files, config.riskyPaths);
  const upgraded = autoUpgrade(original, riskyFiles, config, at);

  const ctx = gateContext(root, config, upgraded);
  const gate = { ...evaluateGate(report, ctx), riskyFiles, ...(ctx.checks && { checks: ctx.checks }), ...(ctx.markerHits && { markerHits: ctx.markerHits }) };

  const archivePath = archivePathFor(root, report);
  const task = recordResult(upgraded, {
    stage: report.stage, verdict: gate.verdict, returnTo: report.returnTo,
    reportPath: archivePath, reasons: gate.reasons, maxRounds: config.maxRounds, at,
  });
  archiveReport(root, { archivePath, report, gate, sourcePath: reportPath, at });
  writeTask(root, task);
  return warnings.length ? { task, gate, warnings } : { task, gate };
}
