// Submitting a handoff report: validate it, auto-upgrade the track if the diff is risky,
// run the machine gate, archive the report with the gate result, then advance the task.
import { resolve } from 'node:path';
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

function assertMatchesTask(report, task) {
  if (task.status === 'escalated') {
    throw new Error(`task ${task.id} is escalated (${task.escalation?.reason}); resolve it before submitting`);
  }
  if (!SUBMITTABLE.has(task.status)) throw new Error(`task ${task.id} is ${task.status}; nothing to submit`);
  if (report.taskId !== task.id) throw new Error(`report is for ${report.taskId}, not ${task.id}`);
  if (report.stage !== task.stage) throw new Error(`report stage "${report.stage}" does not match current stage "${task.stage}"`);
  if (report.round !== task.round) throw new Error(`report round ${report.round} does not match task round ${task.round} (stale report?)`);
}

function autoUpgrade(task, riskyFiles, config, at) {
  if (riskyFiles.length === 0 || task.track === 'risky') return task;
  const reason = `diff touches risky paths: ${riskyFiles.slice(0, 5).join(', ')}`;
  return upgradeTrack(task, { track: 'risky', reason, budgetUsd: config.budgetsUsd.risky, at });
}

function gateContext(root, config, task) {
  const workDir = resolve(root, task.worktree ?? config.appDir);
  const ctx = { acIds: acceptanceCriteria(root, task.spec) };
  if (task.stage === 'implementation') ctx.checks = runChecks(config.checks, workDir, config.checkTimeoutMs);
  if (task.stage === 'release') ctx.markerHits = scanMarkers(workDir, config.markerScanDirs, config.userTodoMarker);
  return ctx;
}

export function submitReport(root, config, { id, reportPath, at }) {
  const original = readTask(root, id);
  const report = validateReport(readJson(reportPath, 'report'));
  assertMatchesTask(report, original);

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
  return { task, gate };
}
