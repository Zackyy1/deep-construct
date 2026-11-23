#!/usr/bin/env node
// dc-init: start a new project from this engine. Copies the engine as committed at HEAD into
// <target-dir>, stamps the engine version into dc.config.json and starts a fresh git repo there.
// The new project never pulls engine updates; see memory notes on distribution.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initProject } from '../lib/init.mjs';

const ENGINE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const USAGE = 'usage: dc-init <target-dir>';

const target = process.argv[2];
if (!target || target.startsWith('-')) {
  process.stderr.write(`${USAGE}\n`);
  process.exit(2);
}

try {
  const { target: dir, engine } = initProject({ source: ENGINE_ROOT, target });
  if (engine.dirty) process.stderr.write('warning: the engine has uncommitted changes; they were not copied (only HEAD is)\n');
  process.stdout.write(`${JSON.stringify({ ok: true, target: dir, engine: { version: engine.version, commit: engine.commit } })}\n`);
  process.stderr.write(`next: cd ${dir} && npm --prefix harness install && claude\n`);
} catch (err) {
  process.stderr.write(`dc-init: ${err.message}\n`);
  process.exit(2);
}
