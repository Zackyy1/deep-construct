#!/usr/bin/env node
// The office server: serves the 2D office UI and bridges it to the user's own `claude` CLI,
// which runs as the orchestrator inside a deep-construct project.
//
//   node office/server.mjs --project ~/code/my-app [--model opus] [--port 4317]
//
// Local only: it binds to 127.0.0.1 and refuses requests from other origins.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { serveStatic } from './lib/static.mjs';
import { createApi, createHub } from './lib/api.mjs';
import { createClaudeSession } from './lib/claude-session.mjs';
import { createSummaryStore } from './lib/carry-over.mjs';
import { initialState, reduce } from './public/js/bridge-state.js';

const OFFICE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(OFFICE_DIR, 'public');
const SUMMARIES_FILE = path.join(OFFICE_DIR, '.data', 'summaries.json');
const HOST = '127.0.0.1';
const DEFAULT_PORT = 4317;
const DEFAULT_MODEL = 'opus'; // the orchestrator runs on Opus (core/ORCHESTRATOR.md)

function resolveProject(dir) {
  if (!dir) return null;
  const root = path.resolve(dir.replace(/^~(?=$|\/)/, process.env.HOME ?? '~'));
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error(`project folder not found: ${root}`);
  if (!fs.existsSync(path.join(root, 'core', 'ORCHESTRATOR.md'))) {
    throw new Error(`${root} is not a deep-construct project (no core/ORCHESTRATOR.md). Create one with harness/bin/init.mjs.`);
  }
  return { root, name: path.basename(root) };
}

export async function startServer({ port = DEFAULT_PORT, projectDir = null, model = DEFAULT_MODEL } = {}) {
  const project = resolveProject(projectDir);
  const hub = createHub();
  let state = initialState(project ?? { root: '', name: '' });
  const emit = (event) => {
    state = reduce(state, event);
    hub.broadcast(event);
  };

  const session = project
    ? createClaudeSession({ projectRoot: project.root, model, emit, store: createSummaryStore(SUMMARIES_FILE, project.root) })
    : null;

  const server = http.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, HOST, resolve);
  });
  const actualPort = server.address().port;
  const handleApi = createApi({ port: actualPort, hub, getState: () => state, session });

  server.on('request', (req, res) => {
    (async () => {
      if (!(await handleApi(req, res))) await serveStatic(req, res, PUBLIC_DIR);
    })().catch((error) => {
      process.stderr.write(`office: ${error.stack ?? error}\n`);
      if (!res.headersSent) res.writeHead(500).end('Server error');
    });
  });
  server.on('close', () => session?.stop());
  return { server, port: actualPort, project };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { values } = parseArgs({
    options: { project: { type: 'string' }, model: { type: 'string' }, port: { type: 'string' } },
  });
  startServer({
    port: Number(values.port ?? process.env.PORT) || DEFAULT_PORT,
    projectDir: values.project ?? process.env.DC_PROJECT ?? null,
    model: values.model ?? process.env.OFFICE_MODEL ?? DEFAULT_MODEL,
  })
    .then(({ server, port, project }) => {
      process.stdout.write(`office running at http://${HOST}:${port}\n`);
      process.stdout.write(project ? `project: ${project.root}\n` : 'no project (pass --project <dir>); the office runs in demo mode\n');
      const shutdown = () => {
        server.close(() => process.exit(0));
        server.closeAllConnections(); // open event streams would otherwise keep it alive
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    })
    .catch((error) => {
      process.stderr.write(`office: could not start: ${error.message}\n`);
      process.exit(1);
    });
}
