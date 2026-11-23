import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { normalize, toolLabel } from '../lib/normalize.mjs';
import { initialState, reduce, isBusy } from '../public/js/bridge-state.js';
import { desiredWork, officeIdFor } from '../public/js/office-sync.js';
import { ROSTER } from '../public/js/roster.js';
import { checkRequest } from '../lib/api.mjs';
import { createClaudeSession, claudeArgs, childEnv } from '../lib/claude-session.mjs';
import { withCarryOver, summarize, clip } from '../lib/carry-over.mjs';

const fixture = fs.readFileSync(new URL('./fixtures/stream-subagent.jsonl', import.meta.url), 'utf8')
  .trim().split('\n').map((line) => JSON.parse(line));
const fold = (events, state = initialState({ root: '/p', name: 'p' })) => events.reduce(reduce, state);
const eventsOf = (messages) => messages.flatMap((m, i) => normalize(m, 1000 + i));

// --- normalize: real claude output -> office events --------------------------

test('a real subagent run becomes start, activity and end events for that agent', () => {
  const events = eventsOf(fixture);
  const start = events.find((e) => e.type === 'agent.start');
  assert.equal(start.agentType, 'dc-scout');
  assert.ok(events.some((e) => e.type === 'agent.activity' && e.toolUseId === start.toolUseId));
  assert.ok(events.some((e) => e.type === 'agent.end' && e.toolUseId === start.toolUseId));
  assert.equal(events.at(-1).type, 'turn.end');
  assert.ok(events.some((e) => e.type === 'session.ready' && e.sessionId));
  assert.ok(events.some((e) => e.type === 'usage.limits' && e.windows.five_hour));
});

test('the orchestrator\'s own Agent call is not logged twice as a tool', () => {
  const tools = eventsOf(fixture).filter((e) => e.type === 'chat.tool').map((e) => e.label);
  assert.ok(!tools.some((label) => label.startsWith('Agent')));
  assert.ok(tools.some((label) => label.startsWith('$ ')), 'the Bash call should be logged');
});

test('tool labels are short and readable', () => {
  assert.equal(toolLabel('Edit', { file_path: '/a/b/app.js' }), 'Edit app.js');
  assert.equal(toolLabel('Bash', { command: 'npm test', description: 'Run the tests' }), '$ Run the tests');
  assert.equal(toolLabel('Grep', { pattern: 'TODO' }), 'Grep TODO');
  assert.equal(toolLabel('Mystery', {}), 'Mystery');
});

test('normalize ignores junk', () => {
  assert.deepEqual(normalize(null), []);
  assert.deepEqual(normalize({ type: 'nope' }), []);
});

// --- reducer -----------------------------------------------------------------

test('folding the real stream ends with an idle orchestrator and no one working', () => {
  const state = fold([{ type: 'chat.user', text: 'go', at: 1 }, ...eventsOf(fixture)]);
  assert.equal(state.session.status, 'ready');
  assert.deepEqual(state.agents, {});
  assert.equal(state.usage.turns, 1);
  assert.ok(state.usage.costUsd > 0);
  assert.deepEqual(state.log.map((e) => e.kind).slice(0, 2), ['user', 'agent-start']);
});

test('reduce never mutates the previous state', () => {
  const before = fold([{ type: 'chat.user', text: 'hi', at: 1 }]);
  const snapshot = structuredClone(before);
  reduce(before, { type: 'agent.start', toolUseId: 't1', agentType: 'dc-architect', description: 'x', at: 2 });
  assert.deepEqual(before, snapshot);
});

test('cost counts per turn even when the claude process restarts', () => {
  const state = fold([
    { type: 'turn.end', costUsd: 0.5, at: 1 },
    { type: 'turn.end', costUsd: 0.75, at: 2 }, // same process: +0.25
    { type: 'turn.end', costUsd: 0.1, at: 3 }, // restarted: +0.10
  ]);
  assert.ok(Math.abs(state.usage.costUsd - 0.85) < 1e-9);
});

test('background subagents survive the end of the turn, foreground ones do not', () => {
  const state = fold([
    { type: 'agent.start', toolUseId: 'fg', agentType: 'dc-scout', description: 'a', at: 1 },
    { type: 'agent.start', toolUseId: 'bg', agentType: 'dc-runner', description: 'b', isBackground: true, at: 2 },
    { type: 'turn.end', costUsd: 0, at: 3 },
  ]);
  assert.deepEqual(Object.keys(state.agents), ['bg']);
});

test('the log is capped', () => {
  const many = Array.from({ length: 450 }, (_, i) => ({ type: 'notice', message: `n${i}`, at: i }));
  const state = fold(many);
  assert.equal(state.log.length, 400);
  assert.equal(state.log.at(-1).text, 'n449');
});

// --- office sync -------------------------------------------------------------

test('a running dc-* subagent puts the matching office agent to work', () => {
  const state = fold([
    { type: 'chat.user', text: 'go', at: 1 },
    { type: 'agent.start', toolUseId: 't1', agentType: 'dc-code-reviewer', description: 'Review T-0001', at: 2 },
    { type: 'agent.activity', toolUseId: 't1', label: 'Read app.js', at: 3 },
  ]);
  const work = desiredWork(state, ROSTER);
  assert.deepEqual(work.get('code-reviewer'), { kind: 'review', label: 'Read app.js' });
  assert.equal(work.get('implementer'), null);
  assert.equal(work.get('orchestrator').kind, 'think');
});

test('everyone is free once the turn is over', () => {
  const state = fold([{ type: 'chat.user', text: 'go', at: 1 }, ...eventsOf(fixture)]);
  assert.ok([...desiredWork(state, ROSTER).values()].every((w) => w === null));
  assert.equal(isBusy(state), false);
});

test('a pending question keeps the orchestrator at the desk', () => {
  const state = fold([{ type: 'question', requestId: 'r1', questions: [{ question: 'Q?', options: [] }], at: 1 }]);
  assert.equal(desiredWork(state, ROSTER).get('orchestrator').label, 'waiting for your answer');
});

test('agent types map to office desks by dropping the dc- prefix', () => {
  assert.equal(officeIdFor('dc-qa-tester'), 'qa-tester');
  for (const agent of ROSTER.filter((a) => a.id !== 'orchestrator')) {
    assert.ok(fs.existsSync(new URL(`../../.claude/agents/dc-${agent.id}.md`, import.meta.url)), `no agent file for ${agent.id}`);
  }
});

// --- request guard -----------------------------------------------------------

test('only the office page itself may call the API', () => {
  const ok = { method: 'POST', headers: { host: '127.0.0.1:4317', origin: 'http://127.0.0.1:4317', 'content-type': 'application/json' } };
  assert.equal(checkRequest(ok, 4317), null);
  assert.equal(checkRequest({ method: 'GET', headers: { host: 'localhost:4317' } }, 4317), null);
  assert.match(checkRequest({ ...ok, headers: { ...ok.headers, host: 'evil.example:4317' } }, 4317), /Host/);
  assert.match(checkRequest({ ...ok, headers: { ...ok.headers, origin: 'https://evil.example' } }, 4317), /cross-origin/);
  assert.match(checkRequest({ ...ok, headers: { ...ok.headers, 'content-type': 'text/plain' } }, 4317), /JSON/);
});

// --- claude session (with a fake claude process) -----------------------------

function fakeSpawn() {
  const calls = [];
  const spawn = (command, args, options) => {
    const proc = new EventEmitter();
    proc.stdin = new PassThrough();
    proc.stdout = new PassThrough();
    proc.stderr = new PassThrough();
    proc.kill = (signal) => proc.emit('exit', null, signal);
    const written = [];
    proc.stdin.on('data', (d) => written.push(...String(d).trim().split('\n').map((l) => JSON.parse(l))));
    calls.push({ command, args, options, proc, written });
    return proc;
  };
  return { spawn, calls };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

function sessionUnderTest(savedSummary = null) {
  const { spawn, calls } = fakeSpawn();
  const events = [];
  let stored = savedSummary;
  const session = createClaudeSession({
    projectRoot: '/p', model: 'opus', emit: (e) => events.push(e), spawn, now: () => 1,
    store: { get: () => stored, set: (summary) => { stored = summary; } },
  });
  return { session, calls, events, stored: () => stored };
}

test('claude runs headless with permission prompts bypassed and questions routed to the office', () => {
  const args = claudeArgs({ model: 'opus' });
  assert.ok(args.includes('-p'));
  assert.deepEqual(args.slice(args.indexOf('--permission-mode'), args.indexOf('--permission-mode') + 2), ['--permission-mode', 'bypassPermissions']);
  assert.deepEqual(args.slice(args.indexOf('--permission-prompt-tool'), args.indexOf('--permission-prompt-tool') + 2), ['--permission-prompt-tool', 'stdio']);
  assert.ok(!args.includes('--resume'), 'every request starts a fresh session');
});

test('maintainer mode never leaks into the agents\' environment', () => {
  const env = childEnv({ PATH: '/bin', DC_MAINTAINER: '1', CLAUDECODE: '1', HOME: '/h' });
  assert.deepEqual(env, { PATH: '/bin', HOME: '/h' });
});

test('sending a prompt starts claude in the project and writes a stream-json user message', async () => {
  const { session, calls, events } = sessionUnderTest();
  session.send('  build a todo app ');
  await tick();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.cwd, '/p');
  assert.deepEqual(calls[0].written[0], { type: 'user', message: { role: 'user', content: 'build a todo app' } });
  assert.deepEqual(events.map((e) => e.type), ['session.status', 'chat.user']);
  assert.throws(() => session.send('   '), /empty/);
});

test('a question from claude is shown, and the answer goes back as a control response', async () => {
  const { session, calls, events } = sessionUnderTest();
  session.send('hi');
  const { proc, written } = calls[0];
  const input = { questions: [{ question: 'Brand?', header: 'Brand', options: [{ label: 'Calm' }, { label: 'Bold' }], multiSelect: false }] };
  proc.stdout.write(`${JSON.stringify({ type: 'control_request', request_id: 'r1', request: { subtype: 'can_use_tool', tool_name: 'AskUserQuestion', input } })}\n`);
  await tick();
  assert.deepEqual(events.at(-1), { type: 'question', requestId: 'r1', questions: input.questions, at: 1 });

  assert.throws(() => session.answer('r1', {}), /every question/);
  session.answer('r1', { 'Brand?': 'Bold', 'Injected?': 'x' });
  await tick();
  const response = written.at(-1);
  assert.equal(response.type, 'control_response');
  assert.equal(response.response.request_id, 'r1');
  assert.deepEqual(response.response.response, { behavior: 'allow', updatedInput: { ...input, answers: { 'Brand?': 'Bold' } } });
  assert.throws(() => session.answer('r1', { 'Brand?': 'Bold' }), /no longer waiting/);
});

const say = (proc, msg) => proc.stdout.write(`${JSON.stringify(msg)}\n`);

test('a message after the request finished starts a fresh session that carries only a summary', async () => {
  const { session, calls, events, stored } = sessionUnderTest();
  session.send('add typed amounts');
  say(calls[0].proc, { type: 'result', subtype: 'success', result: 'Done. Want saving too?' });
  await tick();
  assert.deepEqual(stored(), { request: 'add typed amounts', reply: 'Done. Want saving too?', at: 1 });

  session.send('yes');
  await tick();
  assert.equal(calls.length, 2, 'a new claude process');
  assert.equal(calls[0].proc.stdin.writableEnded, true, 'the old one is closed');
  const first = calls[1].written[0].message.content;
  assert.match(first, /<previous-request>[\s\S]*add typed amounts[\s\S]*Want saving too\?[\s\S]*<\/previous-request>\n\nyes$/);
  calls[0].proc.emit('exit', 0, null);
  await tick();
  assert.notEqual(events.at(-1).type, 'session.status', 'the retired process exiting is not shown');
});

test('a message sent while the orchestrator or a subagent is still working joins the same session', async () => {
  const { session, calls } = sessionUnderTest();
  session.send('build it');
  session.send('also make it blue');
  await tick();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].written[1].message.content, 'also make it blue');

  say(calls[0].proc, { type: 'result', subtype: 'success', result: 'r1' });
  say(calls[0].proc, { type: 'result', subtype: 'success', result: 'r2' });
  say(calls[0].proc, { type: 'system', subtype: 'task_started', task_type: 'local_agent', tool_use_id: 't1' });
  await tick();
  session.send('status?');
  assert.equal(calls.length, 1, 'a background agent is still running');

  say(calls[0].proc, { type: 'system', subtype: 'task_notification', tool_use_id: 't1', status: 'completed' });
  say(calls[0].proc, { type: 'result', subtype: 'success', result: 'r3' });
  await tick();
  session.send('next thing');
  assert.equal(calls.length, 2);
});

test('the carried-over summary is short and absent when there is nothing to carry', () => {
  assert.equal(withCarryOver('hi', null), 'hi');
  assert.equal(summarize([], 'reply', 1), null);
  const summary = summarize(['x'.repeat(5000)], 'y'.repeat(9000), 1);
  assert.ok(summary.request.length <= 1500 && summary.reply.length <= 3000);
  assert.equal(clip('  short ', 10), 'short');
});

test('interrupt sends a control request instead of killing claude', async () => {
  const { session, calls } = sessionUnderTest();
  session.send('hi');
  session.interrupt();
  await tick();
  assert.equal(calls[0].written.at(-1).request.subtype, 'interrupt');
  assert.ok(session.isRunning());
});

// --- "Working now" strip -----------------------------------------------------

test('the working-now strip lists the orchestrator and each running subagent with a start time', async () => {
  const { workingRows } = await import('../public/js/office-sync.js');
  const state = fold([
    { type: 'chat.user', text: 'go', at: 100 },
    { type: 'chat.tool', label: '$ Read context', at: 110 },
    { type: 'agent.start', toolUseId: 't1', agentType: 'dc-ux-lead', description: 'Brand mode proposal', at: 120 },
    { type: 'agent.activity', toolUseId: 't1', label: 'Edit proposal.md', at: 130 },
  ]);
  assert.deepEqual(workingRows(state, ROSTER), [
    { id: 'orchestrator', name: 'Orchestrator', activity: '$ Read context', since: 100 },
    { id: 't1', name: 'UX Lead', activity: 'Edit proposal.md', since: 120 },
  ]);
  assert.deepEqual(workingRows(fold([{ type: 'turn.end', costUsd: 0, at: 1 }], state), ROSTER), []);
});

test('elapsed times read naturally', async () => {
  const { formatElapsed } = await import('../public/js/office-sync.js');
  assert.equal(formatElapsed(42_000), '42s');
  assert.equal(formatElapsed(185_000), '3m 05s');
  assert.equal(formatElapsed(3_720_000), '1h 02m');
  assert.equal(formatElapsed(-5), '0s');
});

test('when claude dies, nobody keeps working in the office', () => {
  const state = fold([
    { type: 'chat.user', text: 'go', at: 1 },
    { type: 'agent.start', toolUseId: 't1', agentType: 'dc-architect', description: 'x', at: 2 },
    { type: 'session.status', status: 'error', at: 3 },
  ]);
  assert.deepEqual(state.agents, {});
  assert.equal(state.session.busySince, null);
  assert.ok([...desiredWork(state, ROSTER).values()].every((w) => w === null));
});

test('background shell commands are not shown as agents', () => {
  const started = normalize({ type: 'system', subtype: 'task_started', task_type: 'local_bash', tool_use_id: 'b1', description: 'cd x && cat > b.mjs' }, 1);
  assert.deepEqual(started, []);
  const state = fold([{ type: 'agent.end', toolUseId: 'b1', status: 'completed', at: 2 }]);
  assert.ok(!state.log.some((e) => e.kind === 'agent-end'));
});
