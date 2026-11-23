#!/usr/bin/env node
// Usage hook, registered for SubagentStop and Stop. Prices token usage, appends it to reports/usage.jsonl
// and charges the task named in the agent's prompt ("Task: T-0001").
//
// SubagentStop: records the finished subagent. Its final message is not yet in the transcript when the
//   hook fires, so a detached copy of this script (--worker) waits until the transcript stops growing.
// Stop (the orchestrator's turn ended): sweeps the whole session, i.e. the orchestrator's own turns and every
//   subagent transcript, so stopped or orphaned agents are counted too.
// Recording is idempotent (only growth since the last entry per agent is logged), so overlapping runs
// never double-count. DC_USAGE_INLINE=1 does the work in-process (tests). Never blocks the session:
// failures go to reports/hook-errors.log.
import { readFileSync, existsSync, appendFileSync, mkdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../../harness/lib/config.mjs';
import { recordAgentUsage, sessionTranscripts } from '../../harness/lib/usage-record.mjs';
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

function chargeTask(root, entry) {
  const { taskId, usd, at } = entry;
  if (!taskId || usd <= 0 || !existsSync(join(root, 'tasks', `${taskId}.json`))) return;
  withTaskLock(root, taskId, () => {
    const task = readTask(root, taskId);
    if (SPENDABLE.has(task.status)) writeTask(root, addSpend(task, { usd, at }));
  });
}

function recordOne(root, config, { path, agentId, agentType, forceTaskId }) {
  if (!path || !existsSync(path)) return;
  const entry = recordAgentUsage(root, {
    agentId, agentType, forceTaskId, transcript: readFileSync(path, 'utf8'),
    prices: config.pricesUsdPerMTok, at: new Date().toISOString(),
  });
  if (entry) chargeTask(root, entry);
}

function work(root, input) {
  const config = loadConfig(root);
  if (input.hook_event_name === 'Stop') {
    for (const t of sessionTranscripts(input.transcript_path)) recordOne(root, config, t);
    return;
  }
  const path = input.agent_transcript_path;
  if (!path || !existsSync(path)) return;
  waitUntilStable(path);
  recordOne(root, config, { path, agentId: input.agent_id ?? path, agentType: input.agent_type });
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
    work(root, JSON.parse(Buffer.from(process.argv[3], 'base64').toString('utf8')));
    return;
  }
  const input = JSON.parse(readFileSync(0, 'utf8'));
  if (process.env.DC_USAGE_INLINE === '1') work(root, input);
  else handOff(input);
}

const root = resolve(process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
try {
  main(root);
} catch (err) {
  mkdirSync(join(root, 'reports'), { recursive: true });
  appendFileSync(join(root, 'reports', 'hook-errors.log'), `${new Date().toISOString()} track-usage: ${err.stack}\n`);
}
