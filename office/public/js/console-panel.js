// The console beside the office: the conversation with the orchestrator, usage, questions
// and the prompt box. All text goes in through textContent, never innerHTML.
import { ROSTER } from './roster.js';
import { isBusy } from './bridge-state.js';
import { officeIdFor, workingRows, formatElapsed } from './office-sync.js';

const NAMES = new Map(ROSTER.map((a) => [a.id, a.name]));
const agentName = (agentType) => NAMES.get(officeIdFor(agentType)) ?? agentType;
const STATUS_TEXT = Object.freeze({
  stopped: 'Idle', starting: 'Starting…', ready: 'Ready', busy: 'Working', error: 'Stopped (error)',
});
const WINDOW_NAMES = Object.freeze({ five_hour: '5-hour window', seven_day: 'Weekly', seven_day_opus: 'Weekly (Opus)' });
const NEAR_BOTTOM = 40; // px
const TICK_MS = 1000; // how often the elapsed timers refresh

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const formatTime = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function logEntry(entry) {
  const item = el('li', `log-entry log-${entry.kind}`);
  const who = {
    user: 'You',
    assistant: 'Orchestrator',
    'agent-start': `▶ ${agentName(entry.meta?.agentType)} started`,
    'agent-end': `✓ ${agentName(entry.meta?.agentType)} finished`,
    question: '? Question for you',
    answer: '↳ Your answer',
    error: 'Error',
  }[entry.kind];
  if (who) item.append(el('span', 'log-who', who));
  item.append(el('span', 'log-text', entry.text));
  item.title = formatTime(entry.at);
  return item;
}

function limitRow(name, window) {
  const pct = Math.round(Math.min(1, Math.max(0, window.utilization)) * 100);
  const row = el('div', 'limit');
  const label = el('div', 'limit-label');
  label.append(el('span', '', WINDOW_NAMES[name] ?? name), el('span', 'limit-pct', `${pct}%`));
  const bar = el('div', 'limit-bar');
  const fill = el('div', `limit-fill${pct >= 80 ? ' is-high' : ''}`);
  fill.style.width = `${pct}%`;
  bar.append(fill);
  row.append(label, bar);
  if (window.resetsAt) row.append(el('div', 'limit-reset', `resets ${formatTime(window.resetsAt * 1000)}`));
  return row;
}

function renderUsage(container, usage) {
  const windows = Object.entries(usage.limits);
  const summary = el('p', 'usage-summary',
    `≈ $${usage.costUsd.toFixed(2)} API-equivalent · ${usage.turns} turn${usage.turns === 1 ? '' : 's'}`);
  summary.title = 'On a subscription this is not billed; it shows what the same work would cost on the API.';
  container.replaceChildren(
    ...(windows.length > 0 ? windows.map(([name, w]) => limitRow(name, w)) : [el('p', 'usage-empty', 'Usage limits appear after the first message.')]),
    summary,
  );
}

/** Builds the answer form for a pending AskUserQuestion. */
function questionForm(question, onAnswer) {
  const form = el('form', 'question-form');
  const picks = new Map(question.questions.map((q) => [q.question, new Set()]));
  const others = new Map();
  const submit = el('button', 'btn btn-primary', 'Answer');
  submit.type = 'submit';

  // Picked options and typed text are combined, so the user can pick some options and add a note.
  const answerFor = (q) => [...picks.get(q.question), others.get(q.question)?.value.trim()].filter(Boolean).join(', ');
  const refresh = () => {
    submit.disabled = !question.questions.every((q) => answerFor(q));
  };

  for (const q of question.questions) {
    const block = el('fieldset', 'question');
    block.append(el('legend', 'question-head', q.header ?? 'Question'), el('p', 'question-text', q.question));
    const options = el('div', 'question-options');
    for (const option of q.options ?? []) {
      const button = el('button', 'option');
      button.type = 'button';
      button.setAttribute('aria-pressed', 'false');
      button.append(el('strong', '', option.label), el('span', '', option.description ?? ''));
      button.addEventListener('click', () => {
        const chosen = picks.get(q.question);
        const next = q.multiSelect ? new Set(chosen) : new Set();
        if (chosen.has(option.label)) next.delete(option.label);
        else next.add(option.label);
        picks.set(q.question, next);
        for (const b of options.children) b.setAttribute('aria-pressed', String(next.has(b.firstChild.textContent)));
        refresh();
      });
      options.append(button);
    }
    const other = el('input', 'question-other');
    other.placeholder = 'Add your own answer or a note';
    other.setAttribute('aria-label', `Your own answer to: ${q.question}`);
    other.addEventListener('input', refresh);
    others.set(q.question, other);
    block.append(options, other);
    form.append(block);
  }
  form.append(submit);
  refresh();
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const answers = Object.fromEntries(question.questions.map((q) => [q.question, answerFor(q)]));
    submit.disabled = true;
    onAnswer(question.requestId, answers).catch(() => refresh());
  });
  return form;
}

/**
 * @param {HTMLElement} root the console <aside>
 * @param {ReturnType<import('./bridge-client.js').connectBridge>} bridge
 */
export function createConsolePanel(root, bridge) {
  const $ = (sel) => root.querySelector(sel);
  const log = $('.log');
  const textarea = $('.composer textarea');
  const sendButton = $('.composer button[type=submit]');
  const stopButton = $('[data-action=interrupt]');
  const errorLine = $('.composer-error');
  const questionBox = $('.question-box');
  let lastLogId = 0;
  let shownQuestionId = null;
  let isSending = false;
  let current = null;

  const showError = (message) => {
    errorLine.textContent = message ?? '';
    errorLine.hidden = !message;
  };

  const run = async (action) => {
    showError(null);
    try {
      await action();
    } catch (error) {
      showError(error.message);
      throw error;
    }
  };

  async function send() {
    const text = textarea.value.trim();
    if (!text || isSending) return;
    isSending = true;
    sendButton.disabled = true;
    try {
      await run(() => bridge.prompt(text));
      textarea.value = '';
    } catch {
      // already shown in the composer
    } finally {
      isSending = false;
      update(current);
    }
  }

  $('.composer').addEventListener('submit', (e) => {
    e.preventDefault();
    send();
  });
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send();
    }
  });
  stopButton.addEventListener('click', () => run(() => bridge.interrupt()).catch(() => {}));

  function renderLog(state) {
    const isNearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < NEAR_BOTTOM;
    const lastId = state.log.at(-1)?.id ?? 0;
    if (lastId < lastLogId) {
      log.replaceChildren(); // the server restarted and its log ids began again
      lastLogId = 0;
    }
    for (const entry of state.log) {
      if (entry.id <= lastLogId) continue;
      const item = logEntry(entry);
      item.dataset.id = String(entry.id);
      log.append(item);
    }
    lastLogId = Math.max(lastLogId, lastId);
    const firstId = state.log[0]?.id ?? Infinity;
    while (log.firstChild && Number(log.firstChild.dataset.id) < firstId) log.firstChild.remove();
    if (isNearBottom) log.scrollTop = log.scrollHeight;
  }

  function renderQuestion(state) {
    const id = state.question?.requestId ?? null;
    if (id === shownQuestionId) return;
    shownQuestionId = id;
    questionBox.hidden = !id;
    questionBox.replaceChildren(...(id ? [questionForm(state.question, (rid, answers) => run(() => bridge.answer(rid, answers)))] : []));
  }

  // "Working now": who is busy, on what, and for how long. The timers tick every second
  // so a long step (a subagent can work for minutes) never looks like a freeze.
  const nowBox = $('.now');
  function renderNow() {
    const rows = current ? workingRows(current, ROSTER) : [];
    nowBox.hidden = rows.length === 0;
    nowBox.replaceChildren(...rows.map((row) => {
      const item = el('li', 'now-row');
      item.append(
        el('span', 'now-spinner'),
        el('span', 'now-name', row.name),
        el('span', 'now-activity', row.activity),
        el('span', 'now-time', row.since ? formatElapsed(Date.now() - row.since) : ''),
      );
      item.title = `${row.name}: ${row.activity}`;
      return item;
    }));
  }
  setInterval(renderNow, TICK_MS);

  function update(state) {
    if (!state) return;
    current = state;
    const hasProject = Boolean(state.project.root);
    $('[data-field=project]').textContent = hasProject ? state.project.name : 'No project open';
    $('[data-field=project]').title = state.project.root;
    const status = $('[data-field=status]');
    status.textContent = STATUS_TEXT[state.session.status] ?? state.session.status;
    status.dataset.status = state.session.status;
    stopButton.hidden = !isBusy(state);
    textarea.disabled = !hasProject;
    textarea.placeholder = hasProject
      ? 'Tell the orchestrator what to build…  (Enter sends, Shift+Enter for a new line)'
      : 'Start the office with --project <dir> to talk to Claude.';
    sendButton.disabled = !hasProject || isSending;
    renderUsage($('.usage'), state.usage);
    renderLog(state);
    renderQuestion(state);
    renderNow();
  }

  return {
    update,
    setConnected(isConnected) {
      root.classList.toggle('is-offline', !isConnected);
      if (!isConnected) $('[data-field=status]').textContent = 'Reconnecting…';
    },
  };
}
