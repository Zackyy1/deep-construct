// Token usage from a subagent transcript (JSONL). Each API message can appear on several lines; count it once.

const TASK_ID = /\bTask:\s*(T-\d{4,})\b/;
const EMPTY = Object.freeze({ input: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 });
const PER_MILLION = 1_000_000;

function parseLines(text) {
  return text.split('\n').flatMap((line) => {
    try {
      return line.trim() ? [JSON.parse(line)] : [];
    } catch {
      return [];
    }
  });
}

function messageText(content) {
  if (typeof content === 'string') return content;
  return Array.isArray(content) ? content.map((b) => b?.text ?? '').join('\n') : '';
}

function tokens(usage = {}) {
  const split = usage.cache_creation;
  return {
    input: usage.input_tokens ?? 0,
    output: usage.output_tokens ?? 0,
    cacheWrite5m: split ? split.ephemeral_5m_input_tokens ?? 0 : usage.cache_creation_input_tokens ?? 0,
    cacheWrite1h: split ? split.ephemeral_1h_input_tokens ?? 0 : 0,
    cacheRead: usage.cache_read_input_tokens ?? 0,
  };
}

const add = (a, b) => Object.fromEntries(Object.keys(EMPTY).map((k) => [k, a[k] + b[k]]));

export function parseTranscript(text) {
  const entries = parseLines(text);
  const firstUser = entries.find((e) => e.type === 'user');
  const taskId = TASK_ID.exec(messageText(firstUser?.message?.content))?.[1] ?? null;

  const lastById = new Map();
  for (const e of entries) {
    if (e.type === 'assistant' && e.message?.id && e.message?.usage) lastById.set(e.message.id, e.message);
  }
  const byModel = {};
  for (const msg of lastById.values()) {
    const model = msg.model ?? 'unknown';
    byModel[model] = add(byModel[model] ?? EMPTY, tokens(msg.usage));
  }
  return { taskId, byModel };
}

export function costUsd(byModel, prices) {
  let usd = 0;
  const unpriced = [];
  for (const [model, t] of Object.entries(byModel)) {
    const p = prices[model];
    if (!p) {
      unpriced.push(model);
      continue;
    }
    usd += Object.keys(EMPTY).reduce((sum, k) => sum + (t[k] * (p[k] ?? 0)) / PER_MILLION, 0);
  }
  return { usd: Math.round(usd * 1e6) / 1e6, unpriced };
}
