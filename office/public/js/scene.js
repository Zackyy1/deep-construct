// The office scene: layout, agents and pets, plus pure helpers to step and query it.
import { ROSTER } from './roster.js';
import { buildLayout } from './layout.js';
import { createAgent, updateAgent, setWork } from './agents.js';
import { createPets, updatePets } from './pets.js';
import { agentBox } from './render.js';
import { desiredWork, sameWork } from './office-sync.js';

export function createScene(rng = Math.random) {
  const layout = buildLayout(ROSTER);
  const agents = ROSTER.map((def, i) => createAgent(def, layout.seats[i], rng));
  return { layout, agents, pets: createPets(rng) };
}

export function stepScene(scene, dt, rng = Math.random) {
  const ctx = { rng, pois: scene.layout.pois };
  return {
    ...scene,
    agents: scene.agents.map((a) => updateAgent(a, dt, ctx)),
    pets: updatePets(scene.pets, dt, rng),
  };
}

/** Topmost agent under a world point (the one nearest the viewer wins). */
export function agentAt(scene, point) {
  const hits = scene.agents
    .map((agent, i) => ({ agent, box: agentBox(agent, i) }))
    .filter(({ box }) => point.x >= box.x && point.x < box.x + box.w && point.y >= box.y && point.y < box.y + box.h)
    .sort((a, b) => b.agent.pos.y - a.agent.pos.y);
  return hits[0]?.agent ?? null;
}

/** Returns a scene where `pickWork(agent)` decides each agent's work (null = free, undefined = unchanged). */
export function assignWork(scene, pickWork, rng = Math.random) {
  return {
    ...scene,
    agents: scene.agents.map((agent) => {
      const work = pickWork(agent);
      return work === undefined ? agent : setWork(agent, work, rng);
    }),
  };
}

/** Puts the scene in line with what Claude is actually doing. */
export function syncWithBridge(scene, bridgeState, rng = Math.random) {
  const wanted = desiredWork(bridgeState, ROSTER);
  return assignWork(scene, (agent) => {
    const work = wanted.get(agent.id) ?? null;
    return sameWork(agent.work, work) ? undefined : work;
  }, rng);
}

// Demo mode (no project open): work labels for the demo buttons.
const DEMO_LABELS = Object.freeze({
  think: 'planning', write: 'writing the spec', code: 'writing code', test: 'running tests',
  review: 'reviewing the diff', run: 'running commands', search: 'searching the code',
});
export const demoWork = (agent) => ({ kind: agent.def.work, label: DEMO_LABELS[agent.def.work] ?? 'working' });
