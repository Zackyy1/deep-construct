// Agent behaviour. An agent with work stays at (or hurries back to) its desk and shows work
// popups; an agent without work is free to take breaks around the office.
// Every update returns a new agent object; nothing is mutated in place.
import { LANE_Y } from './layout.js';

export const WALK_SPEED = 30; // world px per second
export const HURRY_SPEED = 52; // world px per second, when called back to work
const BREAK_DELAY = Object.freeze([6, 30]); // free time at the desk before wandering off
const BREAK_TIME = Object.freeze([3, 7]);
const BUBBLE_TIME = 2.6;
const DESK_CHATTER = 0.03; // chance per second of a bubble while free at the desk
export const POPUP_LIFE = 1.6;
const POPUP_EVERY = Object.freeze([0.7, 1.5]);

/** What work popups look like for each kind of activity. */
export const WORK_GLYPHS = Object.freeze({
  think: ['💭', '🤔', '…', '?!'],
  write: ['📝', '¶', '✍️', 'spec'],
  code: ['{ }', '</>', '⌨️', 'fn()', '+12 −3'],
  test: ['🧪', '✅', '❌', 'assert'],
  review: ['🔍', 'nit:', 'lgtm', '⚠️'],
  run: ['▶', '$ npm', '⚙️', 'exit 0'],
  search: ['🔎', 'grep', '📂'],
});

const IDLE_LINES = Object.freeze(['…', 'anything for me?', '🙂', 'stretch', 'hmm']);

/** @param {() => number} rng returns [0, 1) */
export const between = (rng, [min, max]) => min + rng() * (max - min);
const pick = (rng, list) => list[Math.floor(rng() * list.length)];

/**
 * @typedef {{ x: number, y: number }} Point
 * @typedef {'seated' | 'walking' | 'idle'} Mode
 * @typedef {{ kind: keyof typeof WORK_GLYPHS, label: string }} Work
 * @typedef {{ text: string, age: number, dx: number }} Popup
 * @typedef {{
 *   id: string, def: object, seat: object, mode: Mode, pos: Point, path: Point[], route: Point[],
 *   next: Mode | null, poi: object | null, timer: number, facing: 1 | -1, bubble: object | null,
 *   work: Work | null, popups: Popup[], popupTimer: number, phase: number, laneOffset: number,
 * }} Agent
 */

/** @returns {Agent} */
export function createAgent(def, seat, rng) {
  return Object.freeze({
    id: def.id,
    def,
    seat,
    mode: 'seated',
    pos: { ...seat.sit },
    path: [],
    route: [],
    next: null,
    poi: null,
    timer: between(rng, BREAK_DELAY),
    facing: seat.facing,
    bubble: null,
    work: null,
    popups: [],
    popupTimer: 0,
    phase: rng() * Math.PI * 2,
    laneOffset: Math.round(between(rng, [-3, 3])),
  });
}

/** Waypoints from a desk to a point of interest (not including the chair itself). */
export function routeToPoi(seat, poi, laneOffset = 0) {
  // The same offset nudges each agent sideways in corridors and up/down in the lane,
  // so people sharing a route walk side by side instead of on top of each other.
  const lane = LANE_Y + laneOffset;
  const corridor = seat.exit.x + laneOffset;
  const approach = poi.approachX ?? poi.stand.x;
  return [
    { x: corridor, y: seat.exit.y },
    { x: corridor, y: lane },
    { x: approach, y: lane },
    { x: approach, y: poi.stand.y },
    poi.stand,
  ].filter(dedupe);
}

function dedupe(p, i, all) {
  return i === 0 || p.x !== all[i - 1].x || p.y !== all[i - 1].y;
}

const EPSILON = 0.01;
const onSegment = (p, a, b) =>
  p.x >= Math.min(a.x, b.x) - EPSILON && p.x <= Math.max(a.x, b.x) + EPSILON &&
  p.y >= Math.min(a.y, b.y) - EPSILON && p.y <= Math.max(a.y, b.y) + EPSILON &&
  Math.abs((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) < EPSILON * Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));

/**
 * The way back to the chair from anywhere on `route` (which starts at the chair):
 * retrace the route from the segment the agent is on, so nobody cuts through desks.
 */
export function routeBackFrom(pos, route) {
  for (let k = route.length - 2; k >= 0; k -= 1) {
    if (onSegment(pos, route[k], route[k + 1])) return route.slice(0, k + 1).reverse();
  }
  return [...route].reverse();
}

/** Moves `dist` world px along `path`. Pure. */
export function stepAlong(pos, path, dist) {
  let here = pos;
  let rest = path;
  let left = dist;
  while (rest.length > 0 && left > 0) {
    const [target] = rest;
    const dx = target.x - here.x;
    const dy = target.y - here.y;
    const len = Math.hypot(dx, dy);
    if (len <= left) {
      here = { x: target.x, y: target.y };
      rest = rest.slice(1);
      left -= len;
    } else {
      here = { x: here.x + (dx / len) * left, y: here.y + (dy / len) * left };
      left = 0;
    }
  }
  return { pos: here, path: rest };
}

const say = (text) => ({ text, ttl: BUBBLE_TIME });
const tickBubble = (bubble, dt) => (bubble && bubble.ttl > dt ? { ...bubble, ttl: bubble.ttl - dt } : null);
const goBack = (agent) => ({ ...agent, mode: 'walking', next: 'seated', path: routeBackFrom(agent.pos, agent.route) });

/**
 * Gives an agent work (or takes it away with `null`). Work always wins over a break:
 * an agent who is away turns around and heads straight back to the desk.
 */
export function setWork(agent, work, rng) {
  if (!work) {
    return Object.freeze({ ...agent, work: null, timer: between(rng, BREAK_DELAY) });
  }
  if (agent.work) return Object.freeze({ ...agent, work }); // already busy: just a new label
  const assigned = { ...agent, work, popupTimer: 0, bubble: agent.mode === 'seated' ? null : say('on it!') };
  const isHeadingAway = agent.mode === 'idle' || (agent.mode === 'walking' && agent.next === 'idle');
  return Object.freeze(isHeadingAway ? goBack(assigned) : assigned);
}

function tickPopups(agent, dt, rng) {
  const aged = agent.popups.map((p) => ({ ...p, age: p.age + dt })).filter((p) => p.age < POPUP_LIFE);
  const isTyping = agent.work && agent.mode === 'seated';
  if (!isTyping) return { ...agent, popups: aged };
  const popupTimer = agent.popupTimer - dt;
  if (popupTimer > 0) return { ...agent, popups: aged, popupTimer };
  const popup = { text: pick(rng, WORK_GLYPHS[agent.work.kind] ?? WORK_GLYPHS.think), age: 0, dx: between(rng, [-6, 6]) };
  return { ...agent, popups: [...aged, popup], popupTimer: between(rng, POPUP_EVERY) };
}

function updateSeated(agent, dt, rng, pois) {
  if (agent.work) return agent;
  const chatter = !agent.bubble && rng() < DESK_CHATTER * dt;
  const bubble = chatter ? say(pick(rng, IDLE_LINES)) : agent.bubble;
  if (agent.timer > 0) return { ...agent, bubble };

  const poi = pick(rng, pois);
  const jitter = Math.round(between(rng, [-5, 5]));
  const target = { ...poi, stand: { x: poi.stand.x + jitter, y: poi.stand.y + agent.laneOffset } };
  const path = routeToPoi(agent.seat, target, agent.laneOffset);
  return { ...agent, bubble, mode: 'walking', next: 'idle', poi: target, path, route: [agent.seat.sit, ...path] };
}

function updateWalking(agent, dt, rng) {
  const speed = agent.work ? HURRY_SPEED : WALK_SPEED;
  const { pos, path } = stepAlong(agent.pos, agent.path, speed * dt);
  const dx = pos.x - agent.pos.x;
  const facing = Math.abs(dx) > 0.001 ? (dx > 0 ? 1 : -1) : agent.facing;
  const moved = { ...agent, pos, path, facing };
  if (path.length > 0) return moved;

  if (agent.next === 'idle') {
    return { ...moved, mode: 'idle', next: null, timer: between(rng, BREAK_TIME), bubble: say(pick(rng, agent.poi.say)) };
  }
  return { ...moved, mode: 'seated', next: null, poi: null, route: [], facing: agent.seat.facing, timer: between(rng, BREAK_DELAY) };
}

function updateIdle(agent) {
  return agent.timer > 0 && !agent.work ? agent : goBack(agent);
}

/** Advances one agent by dt seconds. */
export function updateAgent(agent, dt, { rng, pois }) {
  const ticked = tickPopups({ ...agent, timer: agent.timer - dt, bubble: tickBubble(agent.bubble, dt) }, dt, rng);
  switch (ticked.mode) {
    case 'seated': return Object.freeze(updateSeated(ticked, dt, rng, pois));
    case 'walking': return Object.freeze(updateWalking(ticked, dt, rng));
    case 'idle': return Object.freeze(updateIdle(ticked));
    default: throw new Error(`Unknown agent mode: ${ticked.mode}`);
  }
}

/** Status line shown in the agent card. */
export function describeStatus(agent) {
  if (agent.work) return agent.mode === 'seated' ? `Working · ${agent.work.label}` : 'Hurrying back to the desk';
  if (agent.mode === 'seated') return 'Free · at the desk';
  if (agent.mode === 'idle') return `Free · on a break (${agent.poi?.id ?? 'somewhere'})`;
  return agent.next === 'seated' ? 'Free · heading back to the desk' : `Free · walking to the ${agent.poi?.id ?? 'hall'}`;
}
