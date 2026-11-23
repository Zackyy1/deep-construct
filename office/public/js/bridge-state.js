// The office's view of the Claude session, built by folding office events (see
// lib/normalize.mjs). Shared by the server (to hand new browsers a snapshot) and the
// browser (to apply live events), so both always agree. Pure: never mutates its input.

export const MAX_LOG = 400;
const MAX_TEXT = 4000;

/**
 * @typedef {'stopped' | 'starting' | 'ready' | 'busy' | 'error'} SessionStatus
 * @typedef {{ id: number, kind: string, text: string, at: number, meta?: object }} LogEntry
 * @typedef {{ toolUseId: string, agentType: string, description: string, activity: string, startedAt: number, isBackground: boolean }} ActiveAgent
 * @typedef {{ utilization: number, resetsAt: number | null }} LimitWindow
 */

/** @returns {object} the state before anything has happened */
export function initialState(project = { root: '', name: '' }) {
  return Object.freeze({
    project,
    session: { status: 'stopped', id: null, model: null, busySince: null },
    orchestrator: { activity: null },
    agents: {},
    question: null,
    usage: { costUsd: 0, processCostUsd: 0, turns: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, lastTurn: null, limits: {} },
    log: [],
    nextLogId: 1,
  });
}

const clip = (text) => (text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text);

function appendLog(state, kind, text, at, meta) {
  const entry = { id: state.nextLogId, kind, text: clip(String(text ?? '')), at, ...(meta ? { meta } : {}) };
  const log = [...state.log, entry];
  return { ...state, log: log.length > MAX_LOG ? log.slice(log.length - MAX_LOG) : log, nextLogId: state.nextLogId + 1 };
}

const withSession = (state, patch) => ({ ...state, session: { ...state.session, ...patch } });

/** Background subagents outlive the turn that started them; foreground ones can't. */
const backgroundOnly = (agents) => Object.fromEntries(Object.entries(agents).filter(([, a]) => a.isBackground));

function withoutAgent(agents, toolUseId) {
  const { [toolUseId]: _gone, ...rest } = agents;
  return rest;
}

/**
 * `total_cost_usd` in a result counts from when the claude process started, so a turn's
 * cost is the change since the last result; a drop means the process was restarted.
 */
function addUsage(usage, event) {
  const u = event.usage ?? {};
  const processCost = event.costUsd ?? usage.processCostUsd;
  const turnCost = processCost >= usage.processCostUsd ? processCost - usage.processCostUsd : processCost;
  return {
    ...usage,
    costUsd: usage.costUsd + turnCost,
    processCostUsd: processCost,
    turns: usage.turns + 1,
    inputTokens: usage.inputTokens + (u.input_tokens ?? 0),
    outputTokens: usage.outputTokens + (u.output_tokens ?? 0),
    cacheReadTokens: usage.cacheReadTokens + (u.cache_read_input_tokens ?? 0),
    cacheWriteTokens: usage.cacheWriteTokens + (u.cache_creation_input_tokens ?? 0),
    lastTurn: { costUsd: turnCost, durationMs: event.durationMs ?? null, isError: Boolean(event.isError) },
  };
}

const HANDLERS = Object.freeze({
  'session.status': (s, e) => {
    const isOver = e.status === 'stopped' || e.status === 'error';
    // A dead claude process can't finish anything it started: nobody is working any more.
    return isOver
      ? { ...withSession(s, { status: e.status, busySince: null }), orchestrator: { activity: null }, agents: {}, question: null }
      : withSession(s, { status: e.status });
  },
  'session.ready': (s, e) => withSession(s, { id: e.sessionId, model: e.model ?? s.session.model }),
  'chat.user': (s, e) => withSession(appendLog(s, 'user', e.text, e.at), { status: 'busy', busySince: s.session.busySince ?? e.at }),
  'chat.assistant': (s, e) => appendLog(s, 'assistant', e.text, e.at),
  'chat.tool': (s, e) => ({ ...appendLog(s, 'tool', e.label, e.at), orchestrator: { activity: e.label } }),
  'agent.start': (s, e) => ({
    ...appendLog(s, 'agent-start', e.description, e.at, { agentType: e.agentType }),
    agents: {
      ...s.agents,
      [e.toolUseId]: {
        toolUseId: e.toolUseId, agentType: e.agentType, description: e.description,
        activity: e.description, startedAt: e.at, isBackground: Boolean(e.isBackground),
      },
    },
  }),
  'agent.activity': (s, e) => {
    const agent = s.agents[e.toolUseId];
    return agent ? { ...s, agents: { ...s.agents, [e.toolUseId]: { ...agent, activity: e.label } } } : s;
  },
  'agent.end': (s, e) => {
    const agent = s.agents[e.toolUseId];
    if (!agent) return s;
    const text = `${agent.description}${e.status && e.status !== 'completed' ? ` (${e.status})` : ''}`;
    return { ...appendLog(s, 'agent-end', text, e.at, { agentType: agent.agentType }), agents: withoutAgent(s.agents, e.toolUseId) };
  },
  question: (s, e) => ({ ...appendLog(s, 'question', e.questions.map((q) => q.question).join(' · '), e.at), question: { requestId: e.requestId, questions: e.questions } }),
  'question.answered': (s, e) => ({
    ...appendLog(s, 'answer', Object.entries(e.answers).map(([q, a]) => `${q} → ${a}`).join(' · '), e.at),
    question: null,
  }),
  'turn.end': (s, e) => {
    const ended = {
      ...withSession(s, { status: 'ready', busySince: null }),
      orchestrator: { activity: null },
      agents: backgroundOnly(s.agents),
      usage: addUsage(s.usage, e),
    };
    return e.isError ? appendLog(ended, 'error', e.errorText ?? 'The turn ended with an error.', e.at) : ended;
  },
  'usage.limits': (s, e) => ({ ...s, usage: { ...s.usage, limits: { ...s.usage.limits, ...e.windows } } }),
  error: (s, e) => appendLog(s, 'error', e.message, e.at),
  notice: (s, e) => appendLog(s, 'notice', e.message, e.at),
});

/** Applies one office event. Unknown event types leave the state unchanged. */
export function reduce(state, event) {
  const handler = HANDLERS[event?.type];
  return handler ? Object.freeze(handler(state, event)) : state;
}

/** Whether the orchestrator is busy with a turn right now. */
export const isBusy = (state) => state.session.status === 'busy' || state.session.status === 'starting';
