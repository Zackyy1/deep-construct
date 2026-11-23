// Pipeline definitions: which stages each track can run, which it must run, and which are off unless asked for.
// The orchestrator picks the stages per task (--skip / --with); the track only sets the floor.

export const STAGES = Object.freeze([
  'requirements', 'ux', 'architecture', 'tests', 'implementation',
  'review', 'security', 'qa', 'release', 'docs', 'signoff',
]);

export const TRACK_ORDER = Object.freeze(['trivial', 'standard', 'risky']);

export const SIZES = Object.freeze(['small', 'medium', 'large']);

// stages: every stage the track may run, in order. required: never skippable.
// optIn: off unless named in --with (an independent test engineer costs a full extra agent run).
export const TRACKS = Object.freeze({
  trivial: Object.freeze({
    stages: ['implementation', 'review', 'signoff'],
    required: ['implementation', 'review', 'signoff'],
    optIn: [],
  }),
  standard: Object.freeze({
    stages: ['requirements', 'ux', 'architecture', 'tests', 'implementation', 'review', 'qa', 'release', 'docs', 'signoff'],
    required: ['requirements', 'implementation', 'review', 'signoff'],
    optIn: ['tests'],
  }),
  risky: Object.freeze({
    stages: [...STAGES],
    required: ['requirements', 'architecture', 'tests', 'implementation', 'review', 'security', 'signoff'],
    optIn: [],
  }),
});

const RETURNS_TO_IMPLEMENTATION = new Set(['review', 'security', 'qa', 'signoff']);

function trackDef(track) {
  const def = TRACKS[track];
  if (!def) throw new Error(`unknown track "${track}" (use ${TRACK_ORDER.join(', ')})`);
  return def;
}

export function skippableStages(track) {
  const def = trackDef(track);
  return def.stages.filter((s) => !def.required.includes(s));
}

export function planStages(track, skip = [], withStages = []) {
  const def = trackDef(track);
  const required = skip.filter((s) => def.required.includes(s));
  if (required.length) throw new Error(`track ${track} cannot skip: ${required.join(', ')}`);
  const unknown = [...skip, ...withStages].filter((s) => !def.stages.includes(s));
  if (unknown.length) throw new Error(`track ${track} has no stage: ${unknown.join(', ')}`);
  const badWith = withStages.filter((s) => !def.optIn.includes(s));
  if (badWith.length) throw new Error(`--with only adds opt-in stages (${def.optIn.join(', ') || 'none on this track'}): ${badWith.join(', ')}`);
  const off = new Set([...skip, ...def.optIn.filter((s) => !withStages.includes(s))]);
  return def.stages.filter((s) => !off.has(s));
}

export function upgradeStages(task, newTrack) {
  const def = trackDef(newTrack);
  if (TRACK_ORDER.indexOf(newTrack) <= TRACK_ORDER.indexOf(task.track)) {
    throw new Error(`can only upgrade to a stricter track (current: ${task.track})`);
  }
  const done = task.stages.slice(0, task.stages.indexOf(task.stage) + 1);
  const currentOrder = STAGES.indexOf(task.stage);
  const keptSkips = task.skip.filter((s) => !def.required.includes(s));
  const upcoming = def.stages.filter((s) => STAGES.indexOf(s) > currentOrder && !keptSkips.includes(s));
  return [...done, ...upcoming];
}

export function nextStage(task) {
  const idx = task.stages.indexOf(task.stage);
  return task.stages[idx + 1] ?? null;
}

export function defaultReturnStage(stage) {
  return RETURNS_TO_IMPLEMENTATION.has(stage) ? 'implementation' : stage;
}
