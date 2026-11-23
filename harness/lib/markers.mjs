import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const IGNORED_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'coverage']);
const MAX_FILE_BYTES = 1024 * 1024;

function isIgnored(relPath) {
  return relPath.split(sep).some((part) => IGNORED_DIRS.has(part));
}

function scanFile(root, file, marker) {
  if (statSync(file).size > MAX_FILE_BYTES) return [];
  return readFileSync(file, 'utf8').split('\n').flatMap((text, i) =>
    text.includes(marker) ? [{ file: relative(root, file), line: i + 1, text: text.trim() }] : []);
}

export function scanMarkers(root, dirs, marker) {
  return dirs
    .map((d) => join(root, d))
    .filter((d) => existsSync(d))
    .flatMap((dir) => readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => join(e.parentPath, e.name))
      .filter((f) => !isIgnored(relative(root, f)))
      .flatMap((f) => scanFile(root, f, marker)));
}
