import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTranscript, costUsd } from '../lib/usage.mjs';

const line = (o) => JSON.stringify(o);
const usage = (input, output, cache5m = 0, cacheRead = 0) => ({
  input_tokens: input, output_tokens: output, cache_creation_input_tokens: cache5m, cache_read_input_tokens: cacheRead,
  cache_creation: { ephemeral_5m_input_tokens: cache5m, ephemeral_1h_input_tokens: 0 },
});

const transcript = [
  line({ type: 'user', message: { role: 'user', content: 'Task: T-0042 · Login\nStage: review' } }),
  line({ type: 'assistant', message: { id: 'm1', model: 'claude-haiku-5-5', usage: usage(10, 100, 1000, 0) } }),
  line({ type: 'assistant', message: { id: 'm1', model: 'claude-haiku-5-5', usage: usage(10, 100, 1000, 0) } }),
  line({ type: 'assistant', message: { id: 'm2', model: 'claude-haiku-5-5', usage: usage(5, 50, 0, 2000) } }),
  'not json',
].join('\n');

test('parseTranscript finds the task id and counts each message once', () => {
  const t = parseTranscript(transcript);
  assert.equal(t.taskId, 'T-0042');
  assert.deepEqual(t.byModel['claude-haiku-5-5'], { input: 15, output: 150, cacheWrite5m: 1000, cacheWrite1h: 0, cacheRead: 2000 });
});

test('parseTranscript reads task ids from content blocks and tolerates none', () => {
  const blocks = line({ type: 'user', message: { content: [{ type: 'text', text: 'Task: T-0007' }] } });
  assert.equal(parseTranscript(blocks).taskId, 'T-0007');
  assert.equal(parseTranscript(line({ type: 'user', message: { content: 'hello' } })).taskId, null);
});

test('costUsd prices every token type and reports unknown models', () => {
  const prices = { 'claude-haiku-5-5': { input: 1, output: 10, cacheWrite5m: 2, cacheWrite1h: 3, cacheRead: 0.5 } };
  const byModel = {
    'claude-haiku-5-5': { input: 1_000_000, output: 100_000, cacheWrite5m: 500_000, cacheWrite1h: 0, cacheRead: 2_000_000 },
    'mystery-model': { input: 5, output: 5, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 },
  };
  const { usd, unpriced } = costUsd(byModel, prices);
  assert.equal(usd, 1 + 1 + 1 + 1);
  assert.deepEqual(unpriced, ['mystery-model']);
});
