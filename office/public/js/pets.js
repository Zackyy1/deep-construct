// The office cat wanders; the corgi naps. Pure updates, like agents.js.
import { WORLD } from './layout.js';
import { stepAlong, between } from './agents.js';

const CAT_SPEED = 18;
const CAT_PAUSE = Object.freeze([2, 8]);
// The cat sticks to the walkways so it doesn't stroll across desks.
const CAT_SPOTS = Object.freeze([
  { x: 20, y: 124 }, { x: 90, y: 124 }, { x: 150, y: 126 }, { x: 205, y: 124 },
  { x: 7, y: 200 }, { x: 106, y: 186 }, { x: 106, y: 270 }, { x: 210, y: 230 },
  { x: 228, y: 200 }, { x: 228, y: 270 }, { x: 330, y: 130 },
]);

export function createPets(rng) {
  return Object.freeze({
    cat: { pos: { x: 150, y: 126 }, path: [], timer: between(rng, CAT_PAUSE), facing: 1 },
    corgi: { pos: { x: 279, y: 288 }, facing: -1 },
  });
}

function catRoute(from, to) {
  // Walk along x first, then y, like a cat that knows where the walkways are.
  return [{ x: to.x, y: from.y }, to];
}

function updateCat(cat, dt, rng) {
  if (cat.path.length === 0) {
    const timer = cat.timer - dt;
    if (timer > 0) return { ...cat, timer };
    const spot = CAT_SPOTS[Math.floor(rng() * CAT_SPOTS.length)];
    const goViaLane = Math.abs(spot.y - cat.pos.y) > 4;
    const lane = { x: cat.pos.x, y: 124 };
    const path = goViaLane ? [lane, { x: spot.x, y: 124 }, spot] : catRoute(cat.pos, spot);
    return { ...cat, path, timer: between(rng, CAT_PAUSE) };
  }
  const { pos, path } = stepAlong(cat.pos, cat.path, CAT_SPEED * dt);
  const dx = pos.x - cat.pos.x;
  const facing = Math.abs(dx) > 0.001 ? (dx > 0 ? 1 : -1) : cat.facing;
  return { ...cat, pos: clampToWorld(pos), path, facing };
}

const clampToWorld = (p) => ({
  x: Math.min(WORLD.width - 4, Math.max(4, p.x)),
  y: Math.min(WORLD.height - 2, Math.max(WORLD.floorTop + 8, p.y)),
});

export function updatePets(pets, dt, rng) {
  return Object.freeze({ ...pets, cat: updateCat(pets.cat, dt, rng) });
}
