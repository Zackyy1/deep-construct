// Decides who in the office is working, from the bridge state. Pure.
import { isBusy } from './bridge-state.js';

/** "dc-code-reviewer" -> "code-reviewer"; the office ids are the agent names without "dc-". */
export const officeIdFor = (agentType) => String(agentType ?? '').replace(/^dc-/, '');

const MAX_LABEL = 60;
const shorten = (text) => (text.length > MAX_LABEL ? `${text.slice(0, MAX_LABEL - 1)}…` : text);

function orchestratorLabel(state, helpers) {
  if (state.question) return 'waiting for your answer';
  if (helpers.length > 0) return `with ${helpers.join(', ')}`;
  return state.orchestrator.activity ?? 'thinking';
}

/**
 * @param {object} state bridge state (see bridge-state.js)
 * @param {readonly object[]} roster office agents (see roster.js)
 * @returns {Map<string, { kind: string, label: string } | null>} work for every agent; null = free
 */
export function desiredWork(state, roster) {
  const known = new Set(roster.map((a) => a.id));
  const active = Object.values(state.agents).sort((a, b) => a.startedAt - b.startedAt);
  const byAgent = new Map();
  const helpers = [];
  for (const run of active) {
    const id = officeIdFor(run.agentType);
    if (!known.has(id) || id === 'orchestrator') {
      helpers.push(run.agentType); // e.g. a built-in Explore agent: no desk for it
      continue;
    }
    byAgent.set(id, [...(byAgent.get(id) ?? []), run]);
  }

  return new Map(roster.map((def) => {
    if (def.id === 'orchestrator') {
      const isWorking = isBusy(state) || Boolean(state.question);
      return [def.id, isWorking ? { kind: def.work, label: shorten(orchestratorLabel(state, helpers)) } : null];
    }
    const runs = byAgent.get(def.id);
    if (!runs) return [def.id, null];
    const latest = runs[runs.length - 1];
    const extra = runs.length > 1 ? ` (+${runs.length - 1} more)` : '';
    return [def.id, { kind: def.work, label: shorten(`${latest.activity || latest.description}${extra}`) }];
  }));
}

/**
 * Who is working right now and on what, for the console's "Working now" strip:
 * the orchestrator first, then subagents in the order they started.
 * @returns {{ id: string, name: string, activity: string, since: number | null }[]}
 */
export function workingRows(state, roster) {
  const names = new Map(roster.map((a) => [a.id, a.name]));
  const rows = [];
  if (isBusy(state) || state.question) {
    const activity = state.question ? 'waiting for your answer' : state.orchestrator.activity ?? 'thinking';
    rows.push({ id: 'orchestrator', name: names.get('orchestrator') ?? 'Orchestrator', activity, since: state.session.busySince ?? null });
  }
  const active = Object.values(state.agents).sort((a, b) => a.startedAt - b.startedAt);
  for (const run of active) {
    const id = officeIdFor(run.agentType);
    rows.push({ id: run.toolUseId, name: names.get(id) ?? run.agentType, activity: run.activity || run.description, since: run.startedAt });
  }
  return rows;
}

/** "42s", "3m 05s", "1h 02m" */
export function formatElapsed(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

/** True when two work values would look the same in the office. */
export const sameWork = (a, b) => (a?.kind ?? null) === (b?.kind ?? null) && (a?.label ?? null) === (b?.label ?? null);
