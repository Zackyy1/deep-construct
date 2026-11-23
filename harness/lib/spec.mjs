import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const AC_PATTERN = /\bAC-\d+\b/g;

export function acceptanceCriteria(root, specDir) {
  if (!specDir) return [];
  const file = join(root, specDir, 'requirements.md');
  if (!existsSync(file)) return [];
  const ids = new Set(readFileSync(file, 'utf8').match(AC_PATTERN) ?? []);
  return [...ids].sort((a, b) => Number(a.slice(3)) - Number(b.slice(3)));
}
