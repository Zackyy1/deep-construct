import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULTS = Object.freeze({
  appDir: '.',
  baseBranch: 'main',
  maxRounds: 3,
  checkTimeoutMs: 600000,
  checks: {},
  budgetsUsd: { trivial: 1, standard: 8, risky: 20 },
  acBudget: { small: 8, medium: 20, large: 40 },
  riskyPaths: [],
  userTodoMarker: 'USER_TODO #',
  markerScanDirs: ['src', 'app', 'lib'],
  playbookMaxLines: 120,
  testPaths: ['**/*.test.*', '**/*.spec.*', '**/__tests__/**', 'tests/**', '**/tests/**', 'e2e/**', '**/e2e/**'],
  contractPaths: ['**/contracts/**', '**/types/**', '**/*.d.ts', '**/schemas/**'],
  testSupportPaths: ['package.json', 'package-lock.json', 'tsconfig*.json', '*.config.*', '.gitignore'],
  pricesUsdPerMTok: {},
});

const GLOB_LISTS = ['riskyPaths', 'markerScanDirs', 'testPaths', 'contractPaths', 'testSupportPaths'];

export function loadConfig(root) {
  const file = join(root, 'dc.config.json');
  if (!existsSync(file)) throw new Error(`missing ${file}`);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`dc.config.json is not valid JSON: ${err.message}`);
  }
  const config = { ...DEFAULTS, ...parsed };
  if (!Number.isInteger(config.maxRounds) || config.maxRounds < 1) throw new Error('maxRounds must be a positive integer');
  if (typeof config.checks !== 'object' || Array.isArray(config.checks)) throw new Error('checks must be an object of name -> command');
  for (const key of GLOB_LISTS) {
    if (!Array.isArray(config[key]) || config[key].some((g) => typeof g !== 'string')) throw new Error(`${key} must be an array of strings`);
  }
  return Object.freeze(config);
}
