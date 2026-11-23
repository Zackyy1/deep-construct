// Every request runs in a fresh claude session, so the orchestrator never re-reads earlier
// conversations. To let a follow-up ("yes, do that") still make sense, the office keeps a short
// summary of the previous request: what the user asked and the orchestrator's final reply.
// Stored in office/.data/ (gitignored), never inside the project itself.
import fs from 'node:fs';
import path from 'node:path';

const MAX_REQUEST_CHARS = 1500;
const MAX_REPLY_CHARS = 3000;

/** Shortens text to at most `max` characters, keeping the start and marking the cut. */
export function clip(text, max) {
  const value = String(text ?? '').trim();
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}

/** Builds a summary from the user's messages in a session and the orchestrator's last reply. */
export function summarize(requests, reply, at) {
  const request = clip(requests.join('\n\n'), MAX_REQUEST_CHARS);
  return request ? { request, reply: clip(reply, MAX_REPLY_CHARS), at } : null;
}

/** The first message of a fresh session: the previous request's summary (if any), then the prompt. */
export function withCarryOver(prompt, summary) {
  if (!summary?.request) return prompt;
  return [
    '<previous-request>',
    'This is a fresh session. Below is the previous request and your final reply to it, kept only so a',
    'follow-up can continue it. Ignore it if the new message is unrelated. Project state lives in',
    '`task.mjs list` and the task files, not here.',
    '',
    `User asked: ${summary.request}`,
    '',
    `You replied: ${summary.reply || '(no reply recorded)'}`,
    '</previous-request>',
    '',
    prompt,
  ].join('\n');
}

const isSummary = (value) => Boolean(value) && typeof value.request === 'string' && typeof value.reply === 'string';

/** Remembers the last request's summary per project. */
export function createSummaryStore(file, projectRoot) {
  const readAll = () => {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return {};
      process.stderr.write(`office: ignoring unreadable ${file}: ${error.message}\n`);
      return {};
    }
  };
  return {
    get: () => {
      const value = readAll()[projectRoot];
      return isSummary(value) ? value : null;
    },
    set: (summary) => {
      const { [projectRoot]: _old, ...others } = readAll();
      const next = isSummary(summary) ? { ...others, [projectRoot]: summary } : others;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
    },
  };
}
