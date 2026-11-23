#!/usr/bin/env node
// SubagentStop hook. Reads the finished subagent's transcript, prices its token usage, appends it to
// reports/usage.jsonl and adds the cost to the task named in its prompt ("Task: T-0001").
//
// When the hook fires, the subagent's final message is not yet in its transcript. So the hook hands
// the work to a detached copy of itself (--worker), which waits until the transcript stops growing.
// DC_USAGE_INLINE=1 does the work in-process instead (tests). Never blocks the session: failures
// are logged to reports/hook-errors.log.
import { readFileSync, existsSync, appendFileSync, mkdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../../harness/lib/config.mjs';
import { parseTranscript, costUsd } from '../../harness/lib/usage.mjs';
import { appendUsage } from '../../harness/lib/usage-log.mjs';
import { readTask, writeTask, withTaskLock } from '../../harness/lib/store.mjs';
import { addSpend } from '../../harness/lib/transitions.mjs';

const SPENDABLE = new Set(['pending', 'in_progress', 'escalated']);
const POLL_MS = 500;
const STABLE_POLLS = 2;
const MAX_WAIT_MS = 20_000;
const sleeper = new Int32Array(new SharedArrayBuffer(4));

function waitUntilStable(path) {
  const deadline = Date.now() + MAX_WAIT_MS;
  let lastSize = -1;
  let stablePolls = 0;
  while (Date.now() < deadline && stablePolls < STABLE_POLLS) {
    const size = statSync(path).size;
    stablePolls = size === lastSize ? stablePolls + 1 : 0;
    lastSize = size;
    Atomics.wait(sleeper, 0, 0, POLL_MS);
  }
}

function chargeTask(root, taskId, usd, at) {
  if (!existsSync(join(root, 'tasks', `${taskId}.json`)) || usd <= 0) return;
  withTaskLock(root, taskId, () => {
    const task = readTask(root, taskId);
    if (SPENDABLE.has(task.status)) writeTask(root, addSpend(task, { usd, at }));
  });
}

function record(root, input) {
  const transcriptPath = input.agent_transcript_path;
  if (!transcriptPath || !existsSync(transcriptPath)) return;
  waitUntilStable(transcriptPath);
  const config = loadConfig(root);
  const { taskId, byModel } = parseTranscript(readFileSync(transcriptPath, 'utf8'));
  const { usd, unpriced } = costUsd(byModel, config.pricesUsdPerMTok);
  const at = new Date().toISOString();
  appendUsage(root, { at, agentId: input.agent_id, agentType: input.agent_type, taskId, usd, unpriced, byModel });
  if (taskId) chargeTask(root, taskId, usd, at);
}

function handOff(input) {
  const payload = Buffer.from(JSON.stringify(input)).toString('base64');
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--worker', payload], {
    detached: true, stdio: 'ignore', env: process.env,
  });
  child.unref();
}

function main(root) {
  if (process.argv[2] === '--worker') {
    record(root, JSON.parse(Buffer.from(process.argv[3], 'base64').toString('utf8')));
    return;
  }
  const input = JSON.parse(readFileSync(0, 'utf8'));
  if (process.env.DC_USAGE_INLINE === '1') record(root, input);
  else handOff(input);
}

const root = resolve(process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
try {
  main(root);
} catch (err) {
  mkdirSync(join(root, 'reports'), { recursive: true });
  appendFileSync(join(root, 'reports', 'hook-errors.log'), `${new Date().toISOString()} track-usage: ${err.stack}\n`);
}
