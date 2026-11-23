// Task and report persistence. Writes are atomic (temp file + rename) and schema-validated.
import { readFileSync, writeFileSync, renameSync, mkdirSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { validateTask } from './schemas.mjs';
import { withLock } from './lock.mjs';

const TASK_FILE = /^T-(\d{4,})\.json$/;

const tasksDir = (root) => join(root, 'tasks');

function atomicWrite(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  renameSync(tmp, file);
}

export function readJson(file, label) {
  if (!existsSync(file)) throw new Error(`${label} not found: ${file}`);
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`${label} is not valid JSON (${file}): ${err.message}`);
  }
}

export function readTask(root, id) {
  return validateTask(readJson(join(tasksDir(root), `${id}.json`), `task ${id}`));
}

export function writeTask(root, task) {
  validateTask(task);
  mkdirSync(tasksDir(root), { recursive: true });
  atomicWrite(join(tasksDir(root), `${task.id}.json`), task);
  return task;
}

export function listTasks(root) {
  if (!existsSync(tasksDir(root))) return [];
  return readdirSync(tasksDir(root))
    .filter((f) => TASK_FILE.test(f))
    .sort()
    .map((f) => readTask(root, f.replace('.json', '')));
}

export function nextTaskId(root) {
  const nums = existsSync(tasksDir(root))
    ? readdirSync(tasksDir(root)).map((f) => TASK_FILE.exec(f)?.[1]).filter(Boolean).map(Number)
    : [];
  return `T-${String(Math.max(0, ...nums) + 1).padStart(4, '0')}`;
}

// Picks a free archive path: reports/archive/<id>/<stage>-r<round>[-n].json (relative to root).
export function archivePathFor(root, report) {
  const dir = join(root, 'reports', 'archive', report.taskId);
  const base = `${report.stage}-r${report.round}`;
  let file = join(dir, `${base}.json`);
  for (let n = 2; existsSync(file); n += 1) file = join(dir, `${base}-${n}.json`);
  return relative(root, file);
}

// Reports are archived, never deleted. The inbox copy is removed once archived.
export function archiveReport(root, { archivePath, report, gate, sourcePath, at }) {
  const file = join(root, archivePath);
  mkdirSync(dirname(file), { recursive: true });
  atomicWrite(file, { report, gate, archivedAt: at });
  if (sourcePath && existsSync(sourcePath)) rmSync(sourcePath);
}

// Serialises read-modify-write of one task across processes (CLI, hooks).
export function withTaskLock(root, id, fn) {
  mkdirSync(tasksDir(root), { recursive: true });
  return withLock(join(tasksDir(root), `.${id}.lock`), fn);
}
