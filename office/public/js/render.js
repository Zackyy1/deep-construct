// Draws the world in world pixels; main.js sets the camera transform before calling these.
import { SPRITES, PEOPLE } from './sprites.js';
import { PALETTE } from './palette.js';
import { WORLD, WALL_BASE, bottomOf } from './layout.js';

const PLANK = Object.freeze({ height: 8, length: 48 });
const CLOUD_SPEED = 2.5; // world px per second
const CLOCK = Object.freeze({ x: 165, y: 66, w: 23, h: 9 });

export function drawSprite(ctx, sheet, name, x, y, flip = false) {
  const s = SPRITES[name];
  if (!s) throw new Error(`Unknown sprite: ${name}`);
  const dx = Math.round(x);
  const dy = Math.round(y);
  if (!flip) {
    ctx.drawImage(sheet, s.x, s.y, s.w, s.h, dx, dy, s.w, s.h);
    return;
  }
  ctx.save();
  ctx.translate(dx + s.w, dy);
  ctx.scale(-1, 1);
  ctx.drawImage(sheet, s.x, s.y, s.w, s.h, 0, 0, s.w, s.h);
  ctx.restore();
}

function fill(ctx, color, x, y, w, h) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function drawWall(ctx) {
  const top = WORLD.skyBottom;
  fill(ctx, PALETTE.white, 0, top, WORLD.width, WORLD.floorTop - top);
  fill(ctx, PALETTE.slate, 0, top, WORLD.width, 4);
  fill(ctx, PALETTE.charcoal, 0, top + 4, WORLD.width, 1);
  for (let y = top + 14; y < WORLD.floorTop - 2; y += 10) fill(ctx, PALETTE.silver, 0, y, WORLD.width, 1);
  fill(ctx, PALETTE.silver, 0, WORLD.floorTop - 2, WORLD.width, 2);
}

function drawFloor(ctx) {
  const rows = Math.ceil((WORLD.height - WORLD.floorTop) / PLANK.height);
  for (let row = 0; row < rows; row += 1) {
    const y = WORLD.floorTop + row * PLANK.height;
    fill(ctx, PALETTE.sky, 0, y, WORLD.width, PLANK.height);
    fill(ctx, PALETTE.cyan, 0, y, WORLD.width, 1);
    fill(ctx, PALETTE.navy, 0, y + PLANK.height - 1, WORLD.width, 1);
    const offset = ((row * 29) % PLANK.length) - PLANK.length;
    for (let x = offset; x < WORLD.width; x += PLANK.length) {
      fill(ctx, PALETTE.navy, x, y + 1, 1, PLANK.height - 2);
      fill(ctx, PALETTE.cyan, x + 1, y + 1, 1, PLANK.height - 2);
    }
  }
}

/** The wall and floor never change, so they're painted once into an offscreen canvas. */
export function buildStaticLayer() {
  const layer = document.createElement('canvas');
  layer.width = WORLD.width;
  layer.height = WORLD.height;
  const ctx = layer.getContext('2d');
  drawWall(ctx);
  drawFloor(ctx);
  return layer;
}

/**
 * The sky tiles repeated into one strip, so each frame draws a single image. Drawing the
 * tiles separately leaves a visible seam where they meet at fractional zoom levels.
 */
export function buildSkyStrip(sheet) {
  const { x, y, w, h } = SPRITES.sky;
  const tiles = Math.ceil(WORLD.width / w) + 1;
  const strip = document.createElement('canvas');
  strip.width = w * tiles;
  strip.height = h;
  const ctx = strip.getContext('2d');
  for (let i = 0; i < tiles; i += 1) ctx.drawImage(sheet, x, y, w, h, i * w, 0, w, h);
  return strip;
}

export function drawSky(ctx, skyStrip, time) {
  const offset = Math.round((time * CLOUD_SPEED) % SPRITES.sky.w);
  ctx.drawImage(skyStrip, offset, 0, WORLD.width, SPRITES.sky.h, 0, 0, WORLD.width, SPRITES.sky.h);
}

// 3x5 pixel digits, one string per row, for the live wall clock.
const DIGITS = Object.freeze([
  '111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001',
  '111100111001111', '111100111101111', '111001001001001', '111101111101111', '111101111001111',
]);

function drawDigit(ctx, digit, x, y) {
  const bits = DIGITS[digit];
  for (let i = 0; i < bits.length; i += 1) {
    if (bits[i] === '1') fill(ctx, PALETTE.red, x + (i % 3), y + Math.floor(i / 3), 1, 1);
  }
}

export function drawClock(ctx, date) {
  const { x, y, w, h } = CLOCK;
  fill(ctx, PALETTE.charcoal, x, y, w, h);
  fill(ctx, PALETTE.black, x + 1, y + 1, w - 2, h - 2);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  [hh[0], hh[1]].forEach((d, i) => drawDigit(ctx, Number(d), x + 2 + i * 4, y + 2));
  [mm[0], mm[1]].forEach((d, i) => drawDigit(ctx, Number(d), x + 14 + i * 4, y + 2));
  if (date.getSeconds() % 2 === 0) {
    fill(ctx, PALETTE.red, x + 11, y + 3, 1, 1);
    fill(ctx, PALETTE.red, x + 11, y + 5, 1, 1);
  }
}

/** A few pixels of steam above the coffee mug. */
function drawSteam(ctx, time) {
  ctx.fillStyle = PALETTE.white;
  for (let i = 0; i < 3; i += 1) {
    const t = (time * 0.6 + i / 3) % 1;
    ctx.globalAlpha = 0.8 * (1 - t);
    const x = 129 + Math.round(Math.sin(t * 6 + i) * 1.5);
    ctx.fillRect(x, WALL_BASE - 21 - Math.round(t * 9), 1, 1);
  }
  ctx.globalAlpha = 1;
}

function agentBob(agent, time) {
  if (agent.mode === 'walking') return Math.floor(time * 8 + agent.phase) % 2 === 0 ? -1 : 0;
  if (agent.mode === 'seated' && agent.work) return Math.floor(time * 7 + agent.phase) % 2 === 0 ? -1 : 0; // typing
  if (agent.mode === 'seated') return Math.sin(time * 2.2 + agent.phase) > 0.85 ? -1 : 0;
  return Math.sin(time * 1.3 + agent.phase) > 0.6 ? -1 : 0;
}

/** Sprite name and top-left corner for an agent, so hit-testing and drawing agree. */
export function agentBox(agent, index) {
  const sprite = PEOPLE[index % PEOPLE.length];
  const s = SPRITES[sprite];
  return { sprite, x: Math.round(agent.pos.x - s.w / 2), y: Math.round(agent.pos.y - s.h), w: s.w, h: s.h };
}

/** Builds the depth-sorted draw list: props, agents and pets. */
function drawables(scene, time) {
  const props = scene.layout.props.map((p) => ({ z: bottomOf(p), draw: (ctx, sheet) => drawSprite(ctx, sheet, p.sprite, p.x, p.y, p.flip) }));
  const agents = scene.agents.map((agent, i) => {
    const box = agentBox(agent, i);
    const isSeated = agent.mode === 'seated';
    return {
      z: agent.pos.y + (isSeated ? 1.5 : 0.5),
      draw: (ctx, sheet) => drawSprite(ctx, sheet, box.sprite, box.x, box.y + agentBob(agent, time), agent.facing < 0),
    };
  });
  const { cat, corgi } = scene.pets;
  const pets = [
    { z: cat.pos.y, draw: (ctx, sheet) => drawSprite(ctx, sheet, 'cat', cat.pos.x - 8, cat.pos.y - SPRITES.cat.h, cat.facing < 0) },
    { z: corgi.pos.y, draw: (ctx, sheet) => drawSprite(ctx, sheet, 'corgi', corgi.pos.x - 12, corgi.pos.y - SPRITES.corgi.h, corgi.facing < 0) },
  ];
  return [...props, ...agents, ...pets].sort((a, b) => a.z - b.z);
}

/** @param {{ sheet: HTMLImageElement, staticLayer: HTMLCanvasElement, skyStrip: HTMLCanvasElement }} gfx */
export function drawWorld(ctx, gfx, scene, time, date) {
  const { sheet, staticLayer, skyStrip } = gfx;
  ctx.drawImage(staticLayer, 0, 0);
  drawSky(ctx, skyStrip, time);
  drawClock(ctx, date);
  for (const item of drawables(scene, time)) item.draw(ctx, sheet);
  drawSteam(ctx, time);
}
