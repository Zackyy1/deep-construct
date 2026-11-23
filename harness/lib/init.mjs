import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, relative, resolve, isAbsolute } from 'node:path';

// What a new project gets: the engine as committed at the source's HEAD. Everything else in
// this repo (the office IDE, local state, history) stays behind.
export const TEMPLATE_PATHS = Object.freeze([
  '.claude/agents', '.claude/hooks', '.claude/settings.json', '.gitignore', 'CLAUDE.md',
  'core', 'harness', 'context', 'playbooks', 'memory', 'specs/README.md',
  'reports/inbox/.gitkeep', 'reports/archive/.gitkeep', 'tasks/.gitkeep',
  'USER_TODO.md', 'CHANGELOG.md', 'dc.config.json',
]);

const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;

// Returns stdout as a Buffer when binary is set, otherwise as a string.
function run(cwd, cmd, args, { input, binary = false } = {}) {
  const r = spawnSync(cmd, args, { cwd, input, encoding: binary ? 'buffer' : 'utf8', maxBuffer: MAX_ARCHIVE_BYTES });
  if (r.error) throw new Error(`${cmd} could not run: ${r.error.message}`);
  if (r.status !== 0) {
    const err = String(r.stderr ?? '').trim();
    throw new Error(`${cmd} ${args[0]} failed: ${err || `exit ${r.status}`}`);
  }
  return r.stdout;
}

const isInside = (child, parent) => {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

function assertTarget(source, target) {
  if (isInside(target, source)) throw new Error(`target ${target} is inside the engine repo; pick a directory outside it`);
  if (existsSync(target) && readdirSync(target).length > 0) throw new Error(`target ${target} is not empty`);
}

export function engineVersion(source) {
  const pkg = JSON.parse(readFileSync(join(source, 'harness/package.json'), 'utf8'));
  const commit = run(source, 'git', ['rev-parse', 'HEAD']).trim();
  const dirty = run(source, 'git', ['status', '--porcelain', '--', ...TEMPLATE_PATHS]).trim() !== '';
  return { version: pkg.version, commit, dirty };
}

function stampConfig(target, engine, now) {
  const file = join(target, 'dc.config.json');
  const config = JSON.parse(readFileSync(file, 'utf8'));
  const stamped = { engine: { version: engine.version, commit: engine.commit, createdAt: now.toISOString() }, ...config };
  writeFileSync(file, `${JSON.stringify(stamped, null, 2)}\n`);
}

// Copies the engine from source@HEAD into target and starts a fresh repo there with one commit.
export function initProject({ source, target, now = new Date() }) {
  const src = resolve(source);
  const dst = resolve(target);
  assertTarget(src, dst);
  const engine = engineVersion(src);

  mkdirSync(dst, { recursive: true });
  const tar = run(src, 'git', ['archive', '--format=tar', 'HEAD', '--', ...TEMPLATE_PATHS], { binary: true });
  run(dst, 'tar', ['-xf', '-'], { input: tar });
  stampConfig(dst, engine, now);

  run(dst, 'git', ['init', '-q', '-b', 'main']);
  run(dst, 'git', ['add', '-A']);
  run(dst, 'git', ['commit', '-q', '-m', `chore: start project from deep-construct ${engine.version} (${engine.commit.slice(0, 7)})`]);
  return { target: dst, engine };
}
