// Pipeline definitions: which stages each track runs, in what order.

export const STAGES = Object.freeze([
  'requirements', 'ux', 'architecture', 'tests', 'implementation',
  'review', 'security', 'qa', 'release', 'docs', 'signoff',
]);

export const TRACK_ORDER = Object.freeze(['trivial', 'standard', 'risky']);

export const TRACKS = Object.freeze({
  trivial: Object.freeze({ stages: ['implementation', 'review', 'signoff'], skippable: [] }),
  standard: Object.freeze({
    stages: ['requirements', 'ux', 'architecture', 'tests', 'implementation', 'review', 'qa', 'release', 'docs', 'signoff'],
    skippable: ['ux', 'release', 'docs'],
  }),
  risky: Object.freeze({ stages: [...STAGES], skippable: ['ux'] }),
});

const RETURNS_TO_IMPLEMENTATION = new Set(['review', 'security', 'qa', 'signoff']);

function trackDef(track) {
  const def = TRACKS[track];
  if (!def) throw new Error(`unknown track "${track}" (use ${TRACK_ORDER.join(', ')})`);
  return def;
}

export function planStages(track, skip = []) {
  const def = trackDef(track);
  const bad = skip.filter((s) => !def.skippable.includes(s));
  if (bad.length) throw new Error(`track ${track} cannot skip: ${bad.join(', ')}`);
  return def.stages.filter((s) => !skip.includes(s));
}

export function upgradeStages(task, newTrack) {
  const def = trackDef(newTrack);
  if (TRACK_ORDER.indexOf(newTrack) <= TRACK_ORDER.indexOf(task.track)) {
    throw new Error(`can only upgrade to a stricter track (current: ${task.track})`);
  }
  const done = task.stages.slice(0, task.stages.indexOf(task.stage) + 1);
  const currentOrder = STAGES.indexOf(task.stage);
  const keptSkips = task.skip.filter((s) => def.skippable.includes(s));
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
