import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SPRITES, SHEET_SIZE } from '../public/js/sprites.js';
import { ROSTER } from '../public/js/roster.js';
import { buildLayout, WORLD, LANE_Y } from '../public/js/layout.js';
import { createAgent, updateAgent, routeToPoi, routeBackFrom, stepAlong, setWork } from '../public/js/agents.js';
import { createPets, updatePets } from '../public/js/pets.js';
import { fitCamera, zoomAt, panBy, clampCamera, screenToWorld, worldToScreen, MAX_ZOOM, MIN_ZOOM } from '../public/js/camera.js';
import { resolvePublicPath } from '../lib/static.mjs';

/** Deterministic RNG (mulberry32) so simulations are reproducible. */
function seeded(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('every sprite rect lies inside the sheet', () => {
  for (const [name, r] of Object.entries(SPRITES)) {
    assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= SHEET_SIZE.w && r.y + r.h <= SHEET_SIZE.h, name);
  }
});

test('layout gives every agent its own seat and only uses known sprites', () => {
  const layout = buildLayout(ROSTER);
  assert.equal(layout.seats.length, ROSTER.length);
  const sitSpots = new Set(layout.seats.map((s) => `${s.sit.x},${s.sit.y}`));
  assert.equal(sitSpots.size, ROSTER.length, 'two agents share a chair');
  for (const p of layout.props) assert.ok(SPRITES[p.sprite], `unknown sprite ${p.sprite}`);
});

test('every seat and point of interest is inside the floor area', () => {
  const layout = buildLayout(ROSTER);
  const onFloor = (p) => p.x >= 0 && p.x <= WORLD.width && p.y >= WORLD.floorTop && p.y <= WORLD.height;
  for (const seat of layout.seats) assert.ok(onFloor(seat.sit) && onFloor(seat.exit), seat.agentId);
  for (const poi of layout.pois) assert.ok(onFloor(poi.stand), poi.id);
});

test('a break route leaves via the corridor, follows the lane and comes back to the chair', () => {
  const { seats, pois } = buildLayout(ROSTER);
  const seat = seats[1];
  const poi = pois.find((p) => p.id === 'coffee');
  const out = routeToPoi(seat, poi);
  assert.deepEqual(out[0], seat.exit);
  assert.ok(out.some((p) => p.y === LANE_Y));
  assert.deepEqual(out.at(-1), poi.stand);
  const back = routeBackFrom(poi.stand, [seat.sit, ...out]);
  assert.deepEqual(back.at(-1), seat.sit);
  // Every leg is axis-aligned, so nobody cuts diagonally through desks.
  for (const route of [[seat.sit, ...out], [poi.stand, ...back]]) {
    route.slice(1).forEach((p, i) => assert.ok(p.x === route[i].x || p.y === route[i].y, JSON.stringify([route[i], p])));
  }
});

test('stepAlong moves exactly the given distance and consumes reached waypoints', () => {
  const { pos, path } = stepAlong({ x: 0, y: 0 }, [{ x: 10, y: 0 }, { x: 10, y: 10 }], 15);
  assert.deepEqual(pos, { x: 10, y: 5 });
  assert.equal(path.length, 1);
});

test('agents and pets survive ten simulated minutes without leaving the world', () => {
  const rng = seeded(42);
  const layout = buildLayout(ROSTER);
  let agents = ROSTER.map((def, i) => createAgent(def, layout.seats[i], rng));
  let pets = createPets(rng);
  const modes = new Set();
  for (let t = 0; t < 600; t += 1 / 30) {
    agents = agents.map((a) => updateAgent(a, 1 / 30, { rng, pois: layout.pois }));
    pets = updatePets(pets, 1 / 30, rng);
    agents.forEach((a) => modes.add(a.mode));
  }
  for (const a of [...agents.map((x) => x.pos), pets.cat.pos]) {
    assert.ok(Number.isFinite(a.x) && Number.isFinite(a.y));
    assert.ok(a.x >= 0 && a.x <= WORLD.width && a.y >= WORLD.floorTop && a.y <= WORLD.height, JSON.stringify(a));
  }
  assert.deepEqual([...modes].sort(), ['idle', 'seated', 'walking']);
});

test('updateAgent does not mutate its input', () => {
  const rng = seeded(1);
  const layout = buildLayout(ROSTER);
  const agent = createAgent(ROSTER[0], layout.seats[0], rng);
  const copy = structuredClone({ ...agent, def: null, seat: null });
  updateAgent({ ...agent, timer: 0 }, 0.5, { rng, pois: layout.pois });
  assert.deepEqual({ ...agent, def: null, seat: null }, copy);
});

test('zoomAt keeps the world point under the cursor fixed and respects limits', () => {
  const view = { w: 800, h: 600 };
  const cam = fitCamera(WORLD, view);
  const anchor = { x: 200, y: 150 };
  const before = screenToWorld(cam, view, anchor);
  const zoomed = zoomAt(cam, 2, anchor, view);
  const after = screenToWorld(zoomed, view, anchor);
  assert.ok(Math.abs(before.x - after.x) < 1e-9 && Math.abs(before.y - after.y) < 1e-9);
  assert.equal(zoomAt(cam, 1000, anchor, view).zoom, MAX_ZOOM);
  assert.equal(zoomAt(cam, 0.0001, anchor, view).zoom, MIN_ZOOM);
});

test('screenToWorld and worldToScreen are inverses', () => {
  const view = { w: 1024, h: 768 };
  const cam = { x: 100, y: 80, zoom: 3.5 };
  const p = { x: 42, y: 17 };
  const back = screenToWorld(cam, view, worldToScreen(cam, view, p));
  assert.ok(Math.abs(back.x - p.x) < 1e-9 && Math.abs(back.y - p.y) < 1e-9);
});

test('panning far away is clamped so the office stays on screen', () => {
  const view = { w: 800, h: 600 };
  const cam = clampCamera(panBy({ x: 100, y: 100, zoom: 4 }, -1e6, -1e6), WORLD, view);
  assert.ok(cam.x <= WORLD.width && cam.y <= WORLD.height);
});

test('the static server refuses paths outside public/', () => {
  const root = '/srv/office/public';
  assert.equal(resolvePublicPath('/', root), '/srv/office/public/index.html');
  assert.equal(resolvePublicPath('/js/main.js?v=1', root), '/srv/office/public/js/main.js');
  assert.equal(resolvePublicPath('/../server.mjs', root), null);
  assert.equal(resolvePublicPath('/%2e%2e/%2e%2e/etc/passwd', root), null);
  assert.equal(resolvePublicPath('/%E0%A4%A', root), null);
  assert.equal(resolvePublicPath('/a%00b', root), null);
});
