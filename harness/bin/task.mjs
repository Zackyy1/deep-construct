#!/usr/bin/env node
// dc-task: the only writer of tasks/*.json. Prints JSON to stdout.
// Exit codes: 0 ok/pass, 1 gate failed, 2 invalid input, 3 escalated.
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { resolveRoot, createTaskWorktree } from '../lib/git.mjs';
import { loadConfig } from '../lib/config.mjs';
import { readTask, writeTask, listTasks, nextTaskId, withTaskLock } from '../lib/store.mjs';
import { applyTestView, syncTestView } from '../lib/testview.mjs';
import { summarizeUsage } from '../lib/usage-log.mjs';
import { createTask, startTask, upgradeTrack, addSpend, resolveEscalation, cancelTask } from '../lib/transitions.mjs';
import { submitReport } from '../lib/submit.mjs';

const EXIT = Object.freeze({ OK: 0, GATE_FAILED: 1, INVALID: 2, ESCALATED: 3 });

const USAGE = `usage: dc-task <command> [args]
  create  --title <t> --track trivial|standard|risky [--skip ux,docs] [--spec specs/<feature>] [--git | --branch b --worktree path]
  show    <id>
  list
  start   <id> --owner <role>
  submit  <id> --report <path>
  upgrade <id> --track standard|risky --reason <why>
  spend   <id> --usd <amount>
  resolve <id> --to <stage> --note <why> [--budget <usd>]
  cancel  <id> --note <why>
  usage   [<id>]`;

const OPTIONS = {
  title: { type: 'string' }, track: { type: 'string' }, skip: { type: 'string' }, spec: { type: 'string' },
  branch: { type: 'string' }, worktree: { type: 'string' }, owner: { type: 'string' }, report: { type: 'string' },
  reason: { type: 'string' }, usd: { type: 'string' }, to: { type: 'string' }, note: { type: 'string' },
  budget: { type: 'string' }, git: { type: 'boolean' },
};

function required(values, ...names) {
  const missing = names.filter((n) => !values[n]);
  if (missing.length) throw new Error(`missing --${missing.join(', --')}\n${USAGE}`);
}

function toNumber(value, name) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(`--${name} must be a non-negative number`);
  return n;
}

const statusExit = (task) => (task.status === 'escalated' ? EXIT.ESCALATED : EXIT.OK);

// Locked read-modify-write, then bring the worktree's test view in line with the new stage.
function updateTask(root, config, id, fn) {
  const task = withTaskLock(root, id, () => writeTask(root, fn(readTask(root, id))));
  const warning = syncTestView(root, config, task);
  return { output: warning ? { ...task, warnings: [warning] } : task, code: statusExit(task) };
}

const COMMANDS = {
  create(root, config, _id, v, at) {
    required(v, 'title', 'track');
    if (v.git && (v.branch || v.worktree)) throw new Error('use either --git or --branch/--worktree, not both');
    const id = nextTaskId(root);
    const draft = createTask({
      id, title: v.title, track: v.track, skip: v.skip ? v.skip.split(',') : [],
      spec: v.spec ?? null, branch: v.branch ?? null, worktree: v.worktree ?? null,
      budgetUsd: config.budgetsUsd[v.track], at,
    });
    const git = v.git ? createTaskWorktree(root, { id, title: v.title, baseBranch: config.baseBranch }) : {};
    return { output: writeTask(root, { ...draft, ...git }), code: EXIT.OK };
  },
  show: (root, _c, id) => ({ output: readTask(root, id), code: EXIT.OK }),
  list: (root) => ({
    output: listTasks(root).map(({ id, title, track, stage, status, round, owner }) => ({ id, title, track, stage, status, round, owner })),
    code: EXIT.OK,
  }),
  start(root, config, id, v, at) {
    required(v, 'owner');
    return updateTask(root, config, id, (t) => {
      // Isolation is mandatory for the tests stage: fail the start rather than expose the implementation.
      if (t.stage === 'tests' && t.worktree) applyTestView(resolve(root, t.worktree), config);
      return startTask(t, { owner: v.owner, at });
    });
  },
  submit(root, config, id, v, at) {
    required(v, 'report');
    const result = withTaskLock(root, id, () => submitReport(root, config, { id, reportPath: resolve(v.report), at }));
    const warning = syncTestView(root, config, result.task);
    const code = result.task.status === 'escalated' ? EXIT.ESCALATED : result.gate.verdict === 'pass' ? EXIT.OK : EXIT.GATE_FAILED;
    return { output: warning ? { ...result, warnings: [warning] } : result, code };
  },
  upgrade(root, config, id, v, at) {
    required(v, 'track', 'reason');
    return updateTask(root, config, id, (t) => upgradeTrack(t, { track: v.track, reason: v.reason, budgetUsd: config.budgetsUsd[v.track], at }));
  },
  spend(root, config, id, v, at) {
    required(v, 'usd');
    return updateTask(root, config, id, (t) => addSpend(t, { usd: toNumber(v.usd, 'usd'), at }));
  },
  resolve(root, config, id, v, at) {
    required(v, 'to', 'note');
    const budgetUsd = v.budget ? toNumber(v.budget, 'budget') : undefined;
    return updateTask(root, config, id, (t) => resolveEscalation(t, { to: v.to, note: v.note, budgetUsd, at }));
  },
  cancel(root, config, id, v, at) {
    required(v, 'note');
    return updateTask(root, config, id, (t) => cancelTask(t, { note: v.note, at }));
  },
  usage: (root, _c, id) => ({ output: summarizeUsage(root, id), code: EXIT.OK }),
};

const NEEDS_ID = new Set(['show', 'start', 'submit', 'upgrade', 'spend', 'resolve', 'cancel']);

function main(argv) {
  const { values, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
  const [command, id] = positionals;
  const handler = COMMANDS[command];
  if (!handler) throw new Error(USAGE);
  if ((NEEDS_ID.has(command) || id) && !/^T-\d{4,}$/.test(id ?? '')) throw new Error(`${command} needs a task id like T-0001\n${USAGE}`);
  const root = resolveRoot();
  return handler(root, loadConfig(root), id, values, new Date().toISOString());
}

try {
  const { output, code } = main(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  process.exitCode = code;
} catch (err) {
  process.stderr.write(`dc-task: ${err.message}\n`);
  process.exitCode = EXIT.INVALID;
}
