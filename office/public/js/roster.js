// Who works in the office. Mirrors the dc-* agents in .claude/agents/.
// `pod` groups agents that sit back to back; the orchestrator has the corner desk.

// `work` is the kind of work popups an agent shows by default (see WORK_GLYPHS in agents.js).
const agent = (id, name, role, model, pod, work) => Object.freeze({ id, name, role, model, pod, work });

export const ROSTER = Object.freeze([
  agent('orchestrator', 'Orchestrator', 'Chief architect · runs the cycle', 'Opus', 'boss', 'think'),
  agent('requirements', 'Requirements', 'Turns requests into acceptance criteria', 'Sonnet', 0, 'write'),
  agent('ux-lead', 'UX Lead', 'Screens, states, brand', 'Sonnet', 0, 'write'),
  agent('architect', 'Architect', 'Stack, contracts, task breakdown', 'Sonnet', 1, 'think'),
  agent('implementer', 'Implementer', 'Writes the production code', 'Sonnet', 1, 'code'),
  agent('test-engineer', 'Test Engineer', 'Tests from the spec, before the code', 'Sonnet', 2, 'test'),
  agent('code-reviewer', 'Code Reviewer', 'Fresh-eyes diff review', 'Sonnet', 2, 'review'),
  agent('security-reviewer', 'Security', 'Auth, secrets, injection, data exposure', 'Sonnet', 3, 'review'),
  agent('qa-tester', 'QA Tester', 'Clicks through every AC in a browser', 'Sonnet', 3, 'test'),
  agent('release', 'Release', 'CI, env, deploys, smoke tests', 'Sonnet', 4, 'run'),
  agent('docs', 'Docs', 'README and API docs', 'Haiku', 4, 'write'),
  agent('scout', 'Scout', 'Worker · finds and summarises code', 'Haiku', 5, 'search'),
  agent('runner', 'Runner', 'Worker · runs commands', 'Haiku', 5, 'run'),
  agent('fixer', 'Fixer', 'Worker · mechanical edits', 'Haiku', 6, 'code'),
  agent('scribe', 'Scribe', 'Worker · notes and docs drafts', 'Haiku', 6, 'write'),
]);

export const CHAIR_BY_MODEL = Object.freeze({
  Opus: 'chairRed',
  Sonnet: 'chairBlue',
  Haiku: 'chairGreen',
});
