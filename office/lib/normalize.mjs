// Turns raw `claude -p --output-format stream-json` messages into office events
// (the vocabulary reduced by public/js/bridge-state.js). Pure: one message in, events out.
// Control requests (questions, permission checks) are not handled here; see claude-session.mjs.

const MAX_LABEL = 90;
const SUBAGENT_TOOLS = new Set(['Agent', 'Task']);
const QUIET_SYSTEM = new Set(['hook_started', 'hook_response', 'commands_changed', 'thinking_tokens', 'task_updated']);

const shorten = (text, max = MAX_LABEL) => {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};
const baseName = (p) => String(p ?? '').split('/').filter(Boolean).pop() ?? '';

/** A short human label for a tool call, e.g. "Edit app.js" or "$ run the tests". */
export function toolLabel(name, input = {}) {
  switch (name) {
    case 'Read':
    case 'Edit':
    case 'Write':
    case 'NotebookEdit':
      return `${name} ${baseName(input.file_path ?? input.notebook_path)}`.trim();
    case 'Bash':
      return `$ ${shorten(input.description || input.command, 70)}`;
    case 'Grep':
    case 'Glob':
      return `${name} ${shorten(input.pattern, 60)}`;
    case 'WebFetch':
      return `Fetch ${shorten(input.url, 60)}`;
    case 'WebSearch':
      return `Search “${shorten(input.query, 60)}”`;
    case 'TodoWrite':
      return 'Update the plan';
    default:
      return name;
  }
}

function fromAssistant(msg, at) {
  const blocks = Array.isArray(msg.message?.content) ? msg.message.content : [];
  const parent = msg.parent_tool_use_id ?? null;
  return blocks.flatMap((block) => {
    if (parent) {
      // Work happening inside a subagent: show it as that agent's current activity.
      return block.type === 'tool_use' ? [{ type: 'agent.activity', toolUseId: parent, label: toolLabel(block.name, block.input), at }] : [];
    }
    if (block.type === 'text' && block.text.trim()) return [{ type: 'chat.assistant', text: block.text, at }];
    if (block.type !== 'tool_use') return [];
    // Subagents are announced by task_started, and questions by a control request.
    if (SUBAGENT_TOOLS.has(block.name) || block.name === 'AskUserQuestion') return [];
    return [{ type: 'chat.tool', label: toolLabel(block.name, block.input), at }];
  });
}

/** A tool_result for a subagent's own tool_use id means that subagent has finished. */
function fromUser(msg, at) {
  if (msg.parent_tool_use_id) return [];
  const blocks = Array.isArray(msg.message?.content) ? msg.message.content : [];
  return blocks
    .filter((b) => b.type === 'tool_result')
    .map((b) => ({ type: 'agent.end', toolUseId: b.tool_use_id, status: b.is_error ? 'failed' : 'completed', at }));
}

function fromSystem(msg, at) {
  if (QUIET_SYSTEM.has(msg.subtype)) return [];
  switch (msg.subtype) {
    case 'init':
      return [{ type: 'session.ready', sessionId: msg.session_id, model: msg.model ?? null, at }];
    case 'task_started':
      // Background shell commands also emit task_started (task_type "local_bash"). They are not agents;
      // their progress and end events are ignored by the reducer because no agent was registered.
      if (msg.task_type && msg.task_type !== 'local_agent') return [];
      return [{
        type: 'agent.start',
        toolUseId: msg.tool_use_id,
        agentType: msg.subagent_type ?? 'general-purpose',
        description: shorten(msg.description),
        isBackground: Boolean(msg.is_backgrounded),
        at,
      }];
    case 'task_progress':
      return msg.description ? [{ type: 'agent.activity', toolUseId: msg.tool_use_id, label: shorten(msg.description), at }] : [];
    case 'task_notification':
      return [{ type: 'agent.end', toolUseId: msg.tool_use_id, status: msg.status ?? 'completed', at }];
    default:
      return [];
  }
}

function fromResult(msg, at) {
  const isError = Boolean(msg.is_error) || msg.subtype !== 'success';
  return [{
    type: 'turn.end',
    costUsd: typeof msg.total_cost_usd === 'number' ? msg.total_cost_usd : undefined,
    usage: msg.usage ?? {},
    durationMs: msg.duration_ms ?? msg.duration_api_ms ?? null,
    isError,
    ...(isError ? { errorText: shorten(msg.result ?? msg.subtype ?? 'error', 300) } : {}),
    at,
  }];
}

function fromRateLimit(msg, at) {
  const windows = msg.rate_limit_info?.unifiedWindows ?? {};
  const picked = Object.fromEntries(
    Object.entries(windows).map(([name, w]) => [name, { utilization: Number(w.utilization) || 0, resetsAt: w.resetsAt ?? null }]),
  );
  return Object.keys(picked).length > 0 ? [{ type: 'usage.limits', windows: picked, at }] : [];
}

/**
 * @param {object} msg one parsed line of claude's stream-json output
 * @param {number} [at] timestamp in ms
 * @returns {object[]} office events (possibly none)
 */
export function normalize(msg, at = Date.now()) {
  if (!msg || typeof msg !== 'object') return [];
  switch (msg.type) {
    case 'assistant': return fromAssistant(msg, at);
    case 'user': return fromUser(msg, at);
    case 'system': return fromSystem(msg, at);
    case 'result': return fromResult(msg, at);
    case 'rate_limit_event': return fromRateLimit(msg, at);
    default: return [];
  }
}
