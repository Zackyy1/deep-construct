import Ajv from 'ajv';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCHEMA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'core', 'schemas');

const REPORT_SCHEMA_BY_STAGE = Object.freeze({
  review: 'report-review.schema.json',
  security: 'report-security.schema.json',
  qa: 'report-qa.schema.json',
  tests: 'report-tests.schema.json',
});

let ajv;
function instance() {
  if (ajv) return ajv;
  ajv = new Ajv({ allErrors: true });
  for (const name of readdirSync(SCHEMA_DIR).filter((f) => f.endsWith('.schema.json'))) {
    ajv.addSchema(JSON.parse(readFileSync(join(SCHEMA_DIR, name), 'utf8')));
  }
  return ajv;
}

function validate(schemaId, data, label) {
  const fn = instance().getSchema(schemaId);
  if (!fn) throw new Error(`schema ${schemaId} not found in ${SCHEMA_DIR}`);
  if (!fn(data)) {
    const details = fn.errors.map((e) => `${e.instancePath || '/'} ${e.message}`).join('; ');
    throw new Error(`invalid ${label}: ${details}`);
  }
  return data;
}

export const validateTask = (task) => validate('task.schema.json', task, `task ${task?.id}`);

export function validateReport(report) {
  const schema = REPORT_SCHEMA_BY_STAGE[report?.stage] ?? 'report-generic.schema.json';
  return validate(schema, report, 'report');
}
