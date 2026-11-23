import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOKS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.claude', 'hooks');

function project() {
  const root = mkdtempSync(join(tmpdir(), 'dc-hook-'));
  writeFileSync(join(root, 'dc.config.json'), JSON.stringify({
    playbookMaxLines: 3,
    pricesUsdPerMTok: { 'claude-sonnet-5-5': { input: 2, output: 10, cacheWrite5m: 2.5, cacheWrite1h: 4, cacheRead: 0.1 } },
  }));
  return root;
}

function run(hook, root, input, env = {}) {
  const r = spawnSync('node', [join(HOOKS, hook)], {
    input: JSON.stringify({ cwd: root, ...input }), encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: root, DC_MAINTAINER: '', ...env },
  });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput : null;
}

const guard = (root, tool_name, tool_input, agent_type, env) => run('guard.mjs', root, { tool_name, tool_input, ...(agent_type && { agent_type }) }, env);

test('guard denies a reviewer editing code and allows its report', () => {
  const root = project();
  const denied = guard(root, 'Edit', { file_path: join(root, '.worktrees/T-0001/src/a.ts'), old_string: 'a', new_string: 'b' }, 'dc-code-reviewer');
  assert.equal(denied.permissionDecision, 'deny');
  assert.match(denied.permissionDecisionReason, /may not edit code/);
  assert.equal(guard(root, 'Write', { file_path: join(root, 'reports/inbox/r.json'), content: '{}' }, 'dc-code-reviewer'), null);
});

test('guard treats the main session as the orchestrator', () => {
  const root = project();
  assert.equal(guard(root, 'Write', { file_path: join(root, 'core/RULES.md'), content: 'x' }).permissionDecision, 'deny');
  assert.equal(guard(root, 'Write', { file_path: join(root, 'src/app.ts'), content: 'x' }).permissionDecision, 'deny');
});

test('guard enforces the playbook line cap on edits', () => {
  const root = project();
  mkdirSync(join(root, 'playbooks'));
  writeFileSync(join(root, 'playbooks/dc-docs.md'), 'a\nb\n');
  const ok = guard(root, 'Edit', { file_path: join(root, 'playbooks/dc-docs.md'), old_string: 'b', new_string: 'b\nc' });
  assert.equal(ok, null);
  const over = guard(root, 'Edit', { file_path: join(root, 'playbooks/dc-docs.md'), old_string: 'b', new_string: 'b\nc\nd' });
  assert.equal(over.permissionDecision, 'deny');
});

test('guard blocks the test engineer reading implementation, and Grep over the project root', () => {
  const root = project();
  assert.equal(guard(root, 'Read', { file_path: join(root, '.worktrees/T-0001/src/app.ts') }, 'dc-test-engineer').permissionDecision, 'deny');
  assert.equal(guard(root, 'Grep', { pattern: 'x' }, 'dc-test-engineer').permissionDecision, 'deny');
  assert.equal(guard(root, 'Read', { file_path: join(root, 'specs/f/requirements.md') }, 'dc-test-engineer'), null);
});

test('DC_MAINTAINER=1 bypasses the guard', () => {
  const root = project();
  assert.equal(guard(root, 'Write', { file_path: join(root, 'core/RULES.md'), content: 'x' }, undefined, { DC_MAINTAINER: '1' }), null);
});

test('guard fails closed when the config is broken', () => {
  const root = project();
  writeFileSync(join(root, 'dc.config.json'), '{ nope');
  const r = guard(root, 'Read', { file_path: join(root, 'x') }, 'dc-scout');
  assert.equal(r.permissionDecision, 'deny');
  assert.match(r.permissionDecisionReason, /blocked/);
});

test('track-usage logs priced usage and charges the task', () => {
  const root = project();
  const task = { id: 'T-0001', title: 't', track: 'trivial', skip: [], stages: ['implementation', 'review', 'signoff'], stage: 'implementation',
    status: 'in_progress', owner: 'dc-implementer', round: 1, spec: null, branch: null, worktree: null, budget: { limitUsd: 1, spentUsd: 0 },
    reports: [], escalation: null, createdAt: 'x', updatedAt: 'x', history: [{ at: 'x', event: 'created' }] };
  mkdirSync(join(root, 'tasks'));
  writeFileSync(join(root, 'tasks/T-0001.json'), JSON.stringify(task));
  const transcript = join(root, 'agent.jsonl');
  writeFileSync(transcript, [
    JSON.stringify({ type: 'user', message: { content: 'Task: T-0001 · t' } }),
    JSON.stringify({ type: 'assistant', message: { id: 'm', model: 'claude-sonnet-5-5', usage: { input_tokens: 100000, output_tokens: 100000 } } }),
  ].join('\n'));
  run('track-usage.mjs', root, { hook_event_name: 'SubagentStop', agent_id: 'a1', agent_type: 'dc-implementer', agent_transcript_path: transcript }, { DC_USAGE_INLINE: '1' });
  const logged = JSON.parse(readFileSync(join(root, 'reports/usage.jsonl'), 'utf8'));
  assert.equal(logged.usd, 1.2);
  assert.equal(logged.taskId, 'T-0001');
  const after = JSON.parse(readFileSync(join(root, 'tasks/T-0001.json'), 'utf8'));
  assert.equal(after.budget.spentUsd, 1.2);
  assert.equal(after.status, 'escalated', 'over the $1 budget');
  assert.ok(!existsSync(join(root, 'reports/hook-errors.log')));
});

test('track-usage hands off to a background worker that waits for the transcript to finish', async () => {
  const root = project();
  const transcript = join(root, 'agent.jsonl');
  const assistant = (id) => JSON.stringify({ type: 'assistant', message: { id, model: 'claude-sonnet-5-5', usage: { input_tokens: 0, output_tokens: 100000 } } });
  writeFileSync(transcript, [JSON.stringify({ type: 'user', message: { content: 'no task' } }), assistant('m1')].join('\n'));
  run('track-usage.mjs', root, { hook_event_name: 'SubagentStop', agent_type: 'dc-scout', agent_transcript_path: transcript });
  assert.ok(!existsSync(join(root, 'reports/usage.jsonl')), 'hook returned before recording');
  appendFileSync(transcript, `\n${assistant('m2')}`);
  const deadline = Date.now() + 10000;
  while (!existsSync(join(root, 'reports/usage.jsonl')) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
  const logged = JSON.parse(readFileSync(join(root, 'reports/usage.jsonl'), 'utf8'));
  assert.equal(logged.usd, 2, 'both messages counted, including the one written after the hook fired');
});

const userLine = (text) => JSON.stringify({ type: 'user', message: { content: text } });
const sonnet = (id, output) => JSON.stringify({ type: 'assistant', message: { id, model: 'claude-sonnet-5-5', usage: { input_tokens: 0, output_tokens: output } } });
const usageLog = (root) => readFileSync(join(root, 'reports/usage.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

test('track-usage logs only the growth when the same agent stops again after a resume', () => {
  const root = project();
  const transcript = join(root, 'agent.jsonl');
  writeFileSync(transcript, [userLine('Task: T-0009 · x'), sonnet('m1', 100000)].join('\n'));
  const stop = { hook_event_name: 'SubagentStop', agent_id: 'a1', agent_type: 'dc-code-reviewer', agent_transcript_path: transcript };
  run('track-usage.mjs', root, stop, { DC_USAGE_INLINE: '1' });
  appendFileSync(transcript, `\n${sonnet('m2', 100000)}`);
  run('track-usage.mjs', root, stop, { DC_USAGE_INLINE: '1' });
  run('track-usage.mjs', root, stop, { DC_USAGE_INLINE: '1' });
  const entries = usageLog(root);
  assert.equal(entries.length, 2, 'the third stop added nothing');
  assert.deepEqual(entries.map((e) => e.usd), [1, 1]);
});

test('the Stop sweep records the orchestrator and agents that never reported, without double counting', () => {
  const root = project();
  const sessionDir = join(root, 'sessions');
  mkdirSync(join(sessionDir, 's1', 'subagents'), { recursive: true });
  const main = join(sessionDir, 's1.jsonl');
  writeFileSync(main, [userLine('build me a calculator. Task: T-0001 in text should not attribute'), sonnet('o1', 100000)].join('\n'));
  writeFileSync(join(sessionDir, 's1/subagents/agent-orphan.jsonl'), [userLine('Task: T-0002 · x'), sonnet('s1', 200000)].join('\n'));
  writeFileSync(join(sessionDir, 's1/subagents/agent-orphan.meta.json'), JSON.stringify({ agentType: 'dc-test-engineer' }));

  run('track-usage.mjs', root, { hook_event_name: 'Stop', session_id: 's1', transcript_path: main }, { DC_USAGE_INLINE: '1' });
  run('track-usage.mjs', root, { hook_event_name: 'Stop', session_id: 's1', transcript_path: main }, { DC_USAGE_INLINE: '1' });

  const entries = usageLog(root);
  assert.equal(entries.length, 2);
  const orchestrator = entries.find((e) => e.agentType === 'orchestrator');
  assert.equal(orchestrator.taskId, null, 'orchestrator spend is not charged to a task');
  assert.equal(orchestrator.agentId, 'orchestrator:s1');
  const orphan = entries.find((e) => e.agentId === 'orphan');
  assert.equal(orphan.agentType, 'dc-test-engineer');
  assert.equal(orphan.taskId, 'T-0002');
  assert.equal(orphan.usd, 2);
});
