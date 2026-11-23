// Records token usage idempotently. Each agent's transcript is cumulative, and the same agent can be
// seen several times (SubagentStop after a SendMessage resume, the Stop-hook sweep), so only the growth
// since the last entry for that agentId is logged and charged.
import { readFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { parseTranscript, costUsd } from './usage.mjs';
import { appendUsage, readUsageEntries } from './usage-log.mjs';
import { withLock } from './lock.mjs';

export const ORCHESTRATOR_AGENT = 'orchestrator';
const TOKEN_KEYS = Object.freeze(['input', 'output', 'cacheWrite5m', 'cacheWrite1h', 'cacheRead']);

function sumByModel(entries) {
  const total = {};
  for (const e of entries) {
    for (const [model, t] of Object.entries(e.byModel ?? {})) {
      const prev = total[model] ?? {};
      total[model] = Object.fromEntries(TOKEN_KEYS.map((k) => [k, (prev[k] ?? 0) + (t[k] ?? 0)]));
    }
  }
  return total;
}

function subtractByModel(current, prior) {
  const delta = {};
  for (const [model, t] of Object.entries(current)) {
    const p = prior[model] ?? {};
    const d = Object.fromEntries(TOKEN_KEYS.map((k) => [k, Math.max(0, (t[k] ?? 0) - (p[k] ?? 0))]));
    if (TOKEN_KEYS.some((k) => d[k] > 0)) delta[model] = d;
  }
  return delta;
}

/**
 * Logs the usage this agent added since it was last recorded. Returns the logged entry, or null when
 * nothing new happened. The caller charges entry.usd to entry.taskId.
 */
export function recordAgentUsage(root, { agentId, agentType, transcript, prices, at, forceTaskId }) {
  const parsed = parseTranscript(transcript);
  const taskId = forceTaskId === undefined ? parsed.taskId : forceTaskId;
  mkdirSync(join(root, 'reports'), { recursive: true });
  return withLock(join(root, 'reports', '.usage.lock'), () => {
    const prior = sumByModel(readUsageEntries(root).filter((e) => e.agentId === agentId));
    const byModel = subtractByModel(parsed.byModel, prior);
    if (Object.keys(byModel).length === 0) return null;
    const { usd, unpriced } = costUsd(byModel, prices);
    const entry = { at, agentId, agentType, taskId, usd, unpriced, byModel };
    appendUsage(root, entry);
    return entry;
  });
}

function agentTypeFromMeta(transcriptPath) {
  const meta = transcriptPath.replace(/\.jsonl$/, '.meta.json');
  try {
    return JSON.parse(readFileSync(meta, 'utf8')).agentType ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Everything a main session has spent: the orchestrator's own turns plus every subagent transcript
 * under <session>/subagents/, including agents that were stopped or never reported a SubagentStop.
 */
export function sessionTranscripts(mainTranscriptPath) {
  const sessionId = basename(mainTranscriptPath, '.jsonl');
  const main = { path: mainTranscriptPath, agentId: `${ORCHESTRATOR_AGENT}:${sessionId}`, agentType: ORCHESTRATOR_AGENT, forceTaskId: null };
  const subDir = join(dirname(mainTranscriptPath), sessionId, 'subagents');
  if (!existsSync(subDir)) return [main];
  const subs = readdirSync(subDir)
    .filter((f) => /^agent-.+\.jsonl$/.test(f))
    .map((f) => {
      const path = join(subDir, f);
      return { path, agentId: f.slice('agent-'.length, -'.jsonl'.length), agentType: agentTypeFromMeta(path) };
    });
  return [main, ...subs];
}
