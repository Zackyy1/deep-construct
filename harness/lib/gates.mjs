// Gate evaluation. The verdict is computed from structured data; the agent's own verdict
// can only make the result stricter. "contradicted" flags an agent that claimed pass on a failing gate.

const BLOCKING_SEVERITIES = new Set(['critical', 'high']);

function blockingFindings(findings = []) {
  return findings
    .filter((f) => BLOCKING_SEVERITIES.has(f.severity))
    .map((f) => `${f.severity}: ${f.issue}${f.file ? ` (${f.file}${f.line ? `:${f.line}` : ''})` : ''}`);
}

function missingCriteria(acIds, listedIds) {
  return acIds.filter((id) => !listedIds.includes(id));
}

const STAGE_CHECKS = {
  review: (r) => blockingFindings(r.findings),
  security: (r) => blockingFindings(r.findings),

  implementation: (_r, { checks }) => {
    if (!checks) return ['checks were not run'];
    return checks.filter((c) => c.exitCode !== 0).map((c) => `check "${c.name}" exited ${c.exitCode}`);
  },

  qa: (r, { acIds = [] }) => {
    if (acIds.length === 0) return ['spec has no acceptance criteria (AC-n) to verify'];
    const byId = new Map(r.criteria.map((c) => [c.id, c]));
    return acIds.flatMap((id) => {
      const c = byId.get(id);
      if (!c) return [`${id} was not checked`];
      return c.status === 'pass' ? [] : [`${id} is ${c.status}: ${c.evidence}`];
    });
  },

  tests: (r, { acIds = [] }) => {
    if (acIds.length === 0) return ['spec has no acceptance criteria (AC-n) to test'];
    return missingCriteria(acIds, r.criteriaCovered).map((id) => `${id} has no test`);
  },

  requirements: (_r, { acIds = [], acBudget }) => {
    if (acIds.length === 0) return ['requirements.md has no acceptance criteria (AC-n)'];
    if (acBudget && acIds.length > acBudget) {
      return [`${acIds.length} acceptance criteria is over this task's budget of ${acBudget}. Keep what the user asked for `
        + 'and what it needs to work; move the rest to Open questions or merge criteria.'];
    }
    return [];
  },

  release: (_r, { markerHits = [] }) => markerHits.map((h) => `unresolved marker at ${h.file}:${h.line}: ${h.text}`),
};

export function evaluateGate(report, ctx = {}) {
  const check = STAGE_CHECKS[report.stage];
  const reasons = check ? check(report, ctx) : [];
  const gateFailed = reasons.length > 0;
  const declaredFail = report.verdict === 'fail';
  return {
    verdict: gateFailed || declaredFail ? 'fail' : 'pass',
    contradicted: gateFailed && report.verdict === 'pass',
    reasons: declaredFail ? [...reasons, 'agent declared fail'] : reasons,
  };
}
