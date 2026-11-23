// The office HTTP API: a server-sent event stream of office events plus a few JSON commands.
// The orchestrator runs with permission prompts off, so these endpoints must only ever be
// reachable from the office page itself: see checkRequest.

const MAX_BODY = 64 * 1024;
const HEARTBEAT_MS = 25_000;

/**
 * Rejects anything that isn't the office page talking to its own server: other hosts
 * (DNS rebinding), other origins (a web page POSTing to localhost) and non-JSON posts
 * (which a browser could send cross-site without a preflight).
 * @returns {string | null} why the request is refused, or null if it's fine
 */
export function checkRequest({ method, headers }, port) {
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  if (!allowedHosts.has(String(headers.host ?? '').toLowerCase())) return 'unexpected Host header';
  const origin = headers.origin;
  if (origin !== undefined && !allowedHosts.has(origin.replace(/^http:\/\//, '').toLowerCase())) return 'cross-origin request';
  if (method === 'POST' && !String(headers['content-type'] ?? '').startsWith('application/json')) return 'expected a JSON body';
  return null;
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('The request is too large.'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(Object.assign(new Error('The body is not valid JSON.'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

/** Keeps the list of open event streams and pushes events to all of them. */
export function createHub() {
  let clients = new Set();
  return {
    add(res) {
      clients = new Set([...clients, res]);
      const beat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
      res.on('close', () => {
        clearInterval(beat);
        clients = new Set([...clients].filter((c) => c !== res));
      });
    },
    broadcast(event) {
      const frame = `data: ${JSON.stringify(event)}\n\n`;
      for (const res of clients) res.write(frame);
    },
  };
}

/**
 * @param {{ port: number, hub: ReturnType<typeof createHub>, getState: () => object,
 *   session: ReturnType<import('./claude-session.mjs').createClaudeSession> | null }} deps
 * @returns {(req, res) => Promise<boolean>} true when the request was an API call
 */
export function createApi({ port, hub, getState, session }) {
  const commands = {
    'POST /api/prompt': (body) => session.send(body.text),
    'POST /api/answer': (body) => session.answer(body.requestId, body.answers),
    'POST /api/interrupt': () => session.interrupt(),
  };

  return async function handleApi(req, res) {
    const url = new URL(req.url ?? '/', 'http://office.local');
    if (!url.pathname.startsWith('/api/')) return false;

    const refusal = checkRequest(req, port);
    if (refusal) {
      sendJson(res, 403, { ok: false, error: `Refused: ${refusal}.` });
      return true;
    }

    const route = `${req.method} ${url.pathname}`;
    if (route === 'GET /api/state') {
      sendJson(res, 200, { ok: true, state: getState() });
      return true;
    }
    if (route === 'GET /api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write(`event: snapshot\ndata: ${JSON.stringify(getState())}\n\n`);
      hub.add(res);
      return true;
    }

    const command = commands[route];
    if (!command) {
      sendJson(res, 404, { ok: false, error: 'Unknown API route.' });
      return true;
    }
    if (!session) {
      sendJson(res, 503, { ok: false, error: 'No project is open. Start the office with --project <dir>.' });
      return true;
    }
    try {
      command(await readJson(req));
      sendJson(res, 200, { ok: true });
    } catch (error) {
      sendJson(res, error.status ?? 400, { ok: false, error: error.message });
    }
    return true;
  };
}
