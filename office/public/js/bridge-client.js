// Browser side of the bridge: follows the server's event stream and sends commands.
import { initialState, reduce } from './bridge-state.js';

async function post(path, body) {
  let response;
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('The office server is not reachable.');
  }
  const json = await response.json().catch(() => ({ ok: false, error: `HTTP ${response.status}` }));
  if (!json.ok) throw new Error(json.error ?? `HTTP ${response.status}`);
}

/**
 * @param {{ onState: (state: object) => void, onConnection: (isConnected: boolean) => void }} handlers
 */
export function connectBridge({ onState, onConnection }) {
  let state = initialState();
  const source = new EventSource('/api/events');

  // Sent on every (re)connect, so a dropped connection never leaves the page out of date.
  source.addEventListener('snapshot', (e) => {
    state = JSON.parse(e.data);
    onConnection(true);
    onState(state);
  });
  source.onmessage = (e) => {
    state = reduce(state, JSON.parse(e.data));
    onState(state);
  };
  source.onerror = () => onConnection(false);

  return {
    prompt: (text) => post('/api/prompt', { text }),
    answer: (requestId, answers) => post('/api/answer', { requestId, answers }),
    interrupt: () => post('/api/interrupt', {}),
  };
}
