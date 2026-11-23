// Runs the user's own `claude` CLI as the orchestrator for one project and translates its
// stream into office events. The office never sees or stores credentials: `claude` uses
// whatever login the user already has.
import { spawn as nodeSpawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { normalize } from './normalize.mjs';
import { summarize, withCarryOver } from './carry-over.mjs';

const STDERR_KEEP = 20;
const ANSWERABLE_TOOL = 'AskUserQuestion';
// Never let the child inherit maintainer mode: it would switch off the engine's guard hooks.
const BLOCKED_ENV = Object.freeze(['DC_MAINTAINER', 'CLAUDECODE']);

/** Command-line arguments for a headless orchestrator session. Every session starts fresh. */
export function claudeArgs({ model }) {
  return [
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    // Agents must never stop to ask for tool permission. The engine's own guard hooks
    // still run and can still deny a call.
    '--permission-mode', 'bypassPermissions',
    // Lets the office answer AskUserQuestion: it arrives as a control_request on stdout.
    '--permission-prompt-tool', 'stdio',
    ...(model ? ['--model', model] : []),
  ];
}

export function childEnv(env) {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !BLOCKED_ENV.includes(key)));
}

/** Splits a byte stream into lines, calling onLine for each complete one. */
function lineReader(onLine) {
  let buffer = '';
  return (chunk) => {
    buffer += chunk;
    let index = buffer.indexOf('\n');
    while (index >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line) onLine(line);
      index = buffer.indexOf('\n');
    }
  };
}

/**
 * One claude process serves one request: the user's message, any follow-up typed while it is still
 * working, and the questions it asks. The next message after it has gone idle starts a fresh process,
 * with only a short summary of this request carried over (see carry-over.mjs).
 *
 * @param {{
 *   projectRoot: string, model?: string, emit: (event: object) => void,
 *   store: { get: () => object | null, set: (summary: object | null) => void },
 *   spawn?: typeof nodeSpawn, now?: () => number, command?: string,
 * }} options
 */
export function createClaudeSession({ projectRoot, model, emit, store, spawn = nodeSpawn, now = Date.now, command = 'claude' }) {
  // The current process and what it is doing. Replaced (never edited in place) on every change.
  let run = null;
  let questions = new Map(); // requestId -> original tool input

  const update = (changes) => {
    run = { ...run, ...changes };
  };
  const write = (message) => {
    if (!run?.proc.stdin.writable) throw new Error('The Claude session is not running.');
    run.proc.stdin.write(`${JSON.stringify(message)}\n`);
  };
  const reply = (requestId, response) => write({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response } });
  const replyError = (requestId, error) => write({ type: 'control_response', response: { subtype: 'error', request_id: requestId, error } });

  // Idle: every message has its result and no subagent or background task is still running.
  const isIdle = (r) => r.pendingTurns === 0 && r.tasks.size === 0 && questions.size === 0;

  function handleControlRequest(msg) {
    const { request_id: requestId, request = {} } = msg;
    if (request.subtype !== 'can_use_tool') {
      replyError(requestId, `The office does not support ${request.subtype ?? 'this request'}.`);
      return;
    }
    if (request.tool_name === ANSWERABLE_TOOL) {
      questions = new Map(questions).set(requestId, request.input ?? {});
      emit({ type: 'question', requestId, questions: request.input?.questions ?? [], at: now() });
      return;
    }
    // Bypass mode should not ask about anything else; if it does, allow it as the user asked.
    reply(requestId, { behavior: 'allow', updatedInput: request.input ?? {} });
    emit({ type: 'notice', message: `Allowed ${request.tool_name} automatically.`, at: now() });
  }

  function trackProgress(msg) {
    if (msg.type === 'system' && msg.subtype === 'task_started' && msg.tool_use_id) {
      update({ tasks: new Set(run.tasks).add(msg.tool_use_id) });
    } else if (msg.type === 'system' && msg.subtype === 'task_notification' && msg.tool_use_id) {
      update({ tasks: new Set([...run.tasks].filter((id) => id !== msg.tool_use_id)) });
    } else if (msg.type === 'result') {
      update({ pendingTurns: Math.max(0, run.pendingTurns - 1), lastReply: typeof msg.result === 'string' ? msg.result : run.lastReply });
      // Saved after every result, so a restarted office can still carry the request over.
      store.set(summarize(run.requests, run.lastReply, now()));
    }
  }

  function handleLine(line) {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      emit({ type: 'notice', message: `claude: ${line.slice(0, 300)}`, at: now() });
      return;
    }
    if (msg.type === 'control_request') return handleControlRequest(msg);
    if (msg.type === 'control_response') return undefined;
    trackProgress(msg);
    for (const event of normalize(msg, now())) emit(event);
    return undefined;
  }

  function handleExit(code, signal) {
    const tail = run.stderrTail.join('\n').trim();
    run = null;
    questions = new Map();
    if (code !== 0 && signal !== 'SIGTERM') {
      emit({ type: 'error', message: `Claude stopped unexpectedly (${signal ?? `exit ${code}`}).${tail ? `\n${tail}` : ''}`, at: now() });
    }
    emit({ type: 'session.status', status: code === 0 || signal === 'SIGTERM' ? 'stopped' : 'error', at: now() });
  }

  /** Ends an idle process quietly: it has finished its request, so its exit is not news. */
  function retire() {
    const { proc } = run;
    run = null;
    questions = new Map();
    proc.stdin.end();
  }

  function start() {
    const proc = spawn(command, claudeArgs({ model }), {
      cwd: projectRoot,
      env: childEnv(process.env),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    run = { proc, pendingTurns: 0, tasks: new Set(), requests: [], lastReply: '', stderrTail: [] };
    // Events from a process that has since been retired or replaced are ignored.
    const isCurrent = () => run?.proc === proc;
    proc.stdout.setEncoding('utf8');
    proc.stderr.setEncoding('utf8');
    proc.stdout.on('data', lineReader((line) => {
      if (isCurrent()) handleLine(line);
    }));
    proc.stderr.on('data', lineReader((line) => {
      if (isCurrent()) update({ stderrTail: [...run.stderrTail, line].slice(-STDERR_KEEP) });
    }));
    proc.on('error', (error) => {
      if (!isCurrent()) return;
      run = null;
      emit({ type: 'error', message: `Could not start claude: ${error.message}. Is Claude Code installed and on PATH?`, at: now() });
      emit({ type: 'session.status', status: 'error', at: now() });
    });
    // Writes to a process that failed to start surface here instead of crashing the server.
    proc.stdin.on('error', (error) => {
      if (isCurrent()) update({ stderrTail: [...run.stderrTail, `stdin: ${error.message}`].slice(-STDERR_KEEP) });
    });
    proc.on('exit', (code, signal) => {
      if (isCurrent()) handleExit(code, signal);
    });
    emit({ type: 'session.status', status: 'starting', at: now() });
  }

  return {
    isRunning: () => Boolean(run),

    /**
     * Sends a prompt to the orchestrator. A message typed while it is still working joins that
     * request; otherwise it starts a fresh session carrying only the previous request's summary.
     */
    send(text) {
      const prompt = String(text ?? '').trim();
      if (!prompt) throw new Error('The message is empty.');
      if (run && isIdle(run)) retire();
      const isFirst = !run;
      if (isFirst) start();
      const content = isFirst ? withCarryOver(prompt, store.get()) : prompt;
      update({ pendingTurns: run.pendingTurns + 1, requests: [...run.requests, prompt] });
      emit({ type: 'chat.user', text: prompt, at: now() });
      write({ type: 'user', message: { role: 'user', content } });
    },

    /** Answers a pending AskUserQuestion. `answers` maps question text to the chosen label(s). */
    answer(requestId, answers) {
      const input = questions.get(requestId);
      if (!input) throw new Error('That question is no longer waiting for an answer.');
      const asked = new Set((input.questions ?? []).map((q) => q.question));
      const clean = Object.fromEntries(
        Object.entries(answers ?? {}).filter(([q, a]) => asked.has(q) && typeof a === 'string' && a.trim()),
      );
      if (Object.keys(clean).length !== asked.size) throw new Error('Please answer every question.');
      reply(requestId, { behavior: 'allow', updatedInput: { ...input, answers: clean } });
      questions = new Map([...questions].filter(([id]) => id !== requestId));
      emit({ type: 'question.answered', requestId, answers: clean, at: now() });
    },

    /** Asks claude to stop the current turn (like pressing Esc in the terminal). */
    interrupt() {
      if (!run) return;
      write({ type: 'control_request', request_id: randomUUID(), request: { subtype: 'interrupt' } });
      emit({ type: 'notice', message: 'Asked the orchestrator to stop.', at: now() });
    },

    /** Ends the claude process. The next prompt starts a fresh session. */
    stop() {
      if (run) run.proc.kill('SIGTERM');
    },
  };
}
