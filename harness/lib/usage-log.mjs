// Append-only usage log (reports/usage.jsonl). One line per recorded growth of an agent's usage (see usage-record.mjs). Feeds budgets and the office UI.
import { appendFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const logPath = (root) => join(root, 'reports', 'usage.jsonl');

export function appendUsage(root, entry) {
  mkdirSync(join(root, 'reports'), { recursive: true });
  appendFileSync(logPath(root), `${JSON.stringify(entry)}\n`);
}

export function readUsageEntries(root) {
  if (!existsSync(logPath(root))) return [];
  return readFileSync(logPath(root), 'utf8').split('\n').flatMap((l) => {
    try {
      return l.trim() ? [JSON.parse(l)] : [];
    } catch {
      return [];
    }
  });
}

const round = (n) => Math.round(n * 1e4) / 1e4;

function sumBy(entries, key) {
  return entries.reduce((acc, e) => {
    const k = e[key] ?? 'unattributed';
    return { ...acc, [k]: round((acc[k] ?? 0) + (e.usd ?? 0)) };
  }, {});
}

function tokensByModel(entries) {
  return entries.reduce((acc, e) => {
    const next = { ...acc };
    for (const [model, t] of Object.entries(e.byModel ?? {})) {
      const prev = next[model] ?? {};
      next[model] = Object.fromEntries(Object.entries(t).map(([k, v]) => [k, (prev[k] ?? 0) + v]));
    }
    return next;
  }, {});
}

export function summarizeUsage(root, taskId) {
  const entries = readUsageEntries(root).filter((e) => !taskId || e.taskId === taskId);
  return {
    runs: entries.length,
    totalUsd: round(entries.reduce((s, e) => s + (e.usd ?? 0), 0)),
    byTask: sumBy(entries, 'taskId'),
    byAgent: sumBy(entries, 'agentType'),
    tokensByModel: tokensByModel(entries),
    unpriced: [...new Set(entries.flatMap((e) => e.unpriced ?? []))],
  };
}
