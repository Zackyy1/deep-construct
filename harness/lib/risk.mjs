import { matchesGlob } from 'node:path';

export function riskyMatches(files, patterns) {
  return files.filter((file) => patterns.some((pattern) => matchesGlob(file, pattern)));
}
