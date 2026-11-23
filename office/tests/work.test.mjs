import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROSTER } from '../public/js/roster.js';
import { buildLayout } from '../public/js/layout.js';
import { createAgent, updateAgent, setWork, routeBackFrom } from '../public/js/agents.js';

const DT = 1 / 30;
const WORK = Object.freeze({ kind: 'code', label: 'writing code' });

function seeded(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function setup(seed = 7) {
  const rng = seeded(seed);
  const layout = buildLayout(ROSTER);
  const ctx = { rng, pois: layout.pois };
  const agent = createAgent(ROSTER[4], layout.seats[4], rng);
  return { rng, layout, ctx, agent };
}

/** Runs until `done(agent)` or the time limit; returns the agent and every frame. */
function run(agent, ctx, seconds, done = () => false) {
  let a = agent;
  const frames = [a];
  for (let t = 0; t < seconds && !done(a); t += DT) {
    a = updateAgent(a, DT, ctx);
    frames.push(a);
  }
  return { agent: a, frames };
}

const atDesk = (a) => a.mode === 'seated' && a.pos.x === a.seat.sit.x && a.pos.y === a.seat.sit.y;

test('an agent with work stays at the desk for ten minutes', () => {
  const { rng, ctx, agent } = setup();
  const working = setWork({ ...agent, timer: 0 }, WORK, rng); // its break was due right now
  const { frames } = run(working, ctx, 600);
  assert.ok(frames.every(atDesk), 'a working agent left the desk');
});

test('an agent with work shows work popups, a free one does not', () => {
  const { rng, ctx, agent } = setup();
  const busy = run(setWork(agent, WORK, rng), ctx, 5).frames;
  assert.ok(busy.some((a) => a.popups.length > 0));
  const free = run({ ...agent, timer: 1e9 }, ctx, 5).frames;
  assert.ok(free.every((a) => a.popups.length === 0));
});

test('work called in mid-walk turns the agent around and seats it', () => {
  const { rng, ctx, agent } = setup();
  const walking = run({ ...agent, timer: 0 }, ctx, 2).agent;
  assert.equal(walking.mode, 'walking');
  assert.equal(walking.next, 'idle');

  const called = setWork(walking, WORK, rng);
  assert.equal(called.next, 'seated');
  const { agent: back, frames } = run(called, ctx, 30, atDesk);
  assert.ok(atDesk(back), 'never made it back to the desk');
  assert.ok(frames.every((a) => a.mode !== 'idle'), 'took the break anyway');
});

test('work called during a break ends the break', () => {
  const { rng, ctx, agent } = setup();
  const onBreak = run({ ...agent, timer: 0 }, ctx, 60, (a) => a.mode === 'idle').agent;
  assert.equal(onBreak.mode, 'idle');
  const { agent: back } = run(setWork(onBreak, WORK, rng), ctx, 30, atDesk);
  assert.ok(atDesk(back));
});

test('the way back retraces the corridors instead of cutting through desks', () => {
  const { layout, agent } = setup();
  const poi = layout.pois[0];
  const route = [agent.seat.sit, { x: 50, y: agent.seat.sit.y }, { x: 50, y: 120 }, { x: poi.stand.x, y: 120 }];
  const back = routeBackFrom({ x: 50, y: 140 }, route);
  assert.deepEqual(back, [{ x: 50, y: agent.seat.sit.y }, agent.seat.sit]);
});

test('taking work away lets the agent take breaks again', () => {
  const { rng, ctx, agent } = setup();
  const freed = setWork(setWork(agent, WORK, rng), null, rng);
  assert.equal(freed.work, null);
  const { frames } = run(freed, ctx, 120);
  assert.ok(frames.some((a) => a.mode === 'walking'));
});

test('the office has no whiteboard spot any more', () => {
  const { layout } = setup();
  assert.ok(!layout.pois.some((p) => p.id === 'whiteboard'));
  assert.ok(!layout.props.some((p) => p.sprite === 'whiteboard'));
});
