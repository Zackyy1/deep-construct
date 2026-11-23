import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { riskyMatches } from '../lib/risk.mjs';
import { acceptanceCriteria } from '../lib/spec.mjs';
import { scanMarkers } from '../lib/markers.mjs';

const PATTERNS = ['**/auth/**', 'auth/**', '.env*', '**/migrations/**', '**/middleware.*', 'middleware.*'];

test('riskyMatches flags auth, env, migrations and middleware paths', () => {
  const files = ['src/auth/login.ts', '.env.local', 'db/migrations/001.sql', 'middleware.ts', 'src/ui/Button.tsx'];
  assert.deepEqual(riskyMatches(files, PATTERNS), files.slice(0, 4));
});

test('acceptanceCriteria extracts unique AC ids in numeric order', () => {
  const root = mkdtempSync(join(tmpdir(), 'dc-spec-'));
  mkdirSync(join(root, 'specs/login'), { recursive: true });
  writeFileSync(join(root, 'specs/login/requirements.md'), '- AC-10 x\n- AC-2 y\n- AC-2 again\nnot-AC-x');
  assert.deepEqual(acceptanceCriteria(root, 'specs/login'), ['AC-2', 'AC-10']);
  assert.deepEqual(acceptanceCriteria(root, 'specs/missing'), []);
  assert.deepEqual(acceptanceCriteria(root, null), []);
});

test('scanMarkers finds markers and ignores node_modules', () => {
  const root = mkdtempSync(join(tmpdir(), 'dc-mark-'));
  mkdirSync(join(root, 'src/node_modules/pkg'), { recursive: true });
  writeFileSync(join(root, 'src/pay.ts'), 'const k = "mock"; // USER_TODO #3 real Stripe key\n');
  writeFileSync(join(root, 'src/node_modules/pkg/i.js'), '// USER_TODO #9');
  const hits = scanMarkers(root, ['src', 'nope'], 'USER_TODO #');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].file, 'src/pay.ts');
  assert.equal(hits[0].line, 1);
});
