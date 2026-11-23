// The office floor plan, in world pixels (1 world px = 1 sheet px). Pure data, no DOM.
import { SPRITES } from './sprites.js';
import { ROSTER, CHAIR_BY_MODEL } from './roster.js';

export const WORLD = Object.freeze({
  width: 352,
  height: 292,
  skyBottom: 38,
  floorTop: 108,
});

/** Feet line for things standing against the back wall. */
export const WALL_BASE = 112;
/** The walkway in front of the wall furniture. */
export const LANE_Y = 120;

const POD_COLUMNS = Object.freeze([16, 124]);
const POD_ROWS = Object.freeze([132, 168, 204, 240]);
/** Vertical walkways: left of column 0, between the columns, right of column 1. */
const CORRIDORS = Object.freeze([7, 106, 210]);

// Offsets inside one cubicle pod, relative to the partition's top-left corner.
const POD = Object.freeze({
  deskA: 17, post: 36, deskB: 42, deskY: 19,
  chairLeft: 5, chairRight: 61, chairY: 6,
  pcY: 9, seatFeetY: 27,
});

const PARTITION_DECOR = Object.freeze([
  ['flagUS', 'magnets'], ['paperA', 'flagIN'], ['magnets', 'paperB'], ['flagUK', 'picSunset'],
  ['paperB', 'magnets'], ['picBlue', 'paperA'], ['magnets', 'flagUS'], ['paperA', 'picLandscape'],
]);
const DESK_DECOR = Object.freeze(['binderRed', 'mug', 'binderBlue', 'phone', 'binderGreen', 'tray']);

/**
 * A drawable placed in the world.
 * @typedef {{ sprite: string, x: number, y: number, flip?: boolean, z?: number }} Prop
 * z is the depth key (bigger = drawn later); it defaults to the sprite's bottom edge.
 */
const prop = (sprite, x, y, extra = {}) => Object.freeze({ sprite, x, y, flip: false, ...extra });

export const bottomOf = (p) => p.z ?? p.y + SPRITES[p.sprite].h;

/** @returns {{ x: number, y: number }} top-left of a sprite whose feet stand at (cx, feetY). */
const standAt = (sprite, cx, feetY) => ({
  x: Math.round(cx - SPRITES[sprite].w / 2),
  y: feetY - SPRITES[sprite].h,
});

function podOrigin(index) {
  const col = index % 2;
  const row = Math.floor(index / 2);
  return { x: POD_COLUMNS[col], y: POD_ROWS[row], col };
}

function seatFor(origin, side) {
  const isLeft = side === 'left';
  const chairX = origin.x + (isLeft ? POD.chairLeft : POD.chairRight);
  const sit = { x: chairX + SPRITES.chairBlue.w / 2, y: origin.y + POD.seatFeetY };
  const corridor = CORRIDORS[origin.col + (isLeft ? 0 : 1)];
  return Object.freeze({
    side,
    chair: { x: chairX, y: origin.y + POD.chairY, flip: !isLeft },
    deskX: origin.x + (isLeft ? POD.deskA : POD.deskB),
    sit,
    exit: { x: corridor, y: sit.y },
    facing: isLeft ? 1 : -1,
  });
}

function podProps(index, origin) {
  const deskY = origin.y + POD.deskY;
  const deskZ = deskY + SPRITES.deskA.h;
  const [decorA, decorB] = PARTITION_DECOR[index % PARTITION_DECOR.length];
  return [
    prop('partition', origin.x, origin.y),
    prop(decorA, origin.x + 4, origin.y + 4, { z: origin.y + SPRITES.partition.h + 0.1 }),
    prop(decorB, origin.x + 64, origin.y + 4, { z: origin.y + SPRITES.partition.h + 0.1 }),
    prop('deskA', origin.x + POD.deskA, deskY),
    prop('post', origin.x + POD.post, deskY),
    prop('deskB', origin.x + POD.deskB, deskY),
    prop('pc', origin.x + POD.deskA, origin.y + POD.pcY, { z: deskZ + 0.1 }),
    prop('pc', origin.x + POD.deskB + 2, origin.y + POD.pcY, { flip: true, z: deskZ + 0.1 }),
    prop(DESK_DECOR[index % DESK_DECOR.length], origin.x + POD.deskB + 4, deskY + 10, { z: deskZ + 0.2 }),
  ];
}

function wallProps() {
  const wall = (sprite, x, y) => prop(sprite, x, y, { z: 0 });
  const floorItem = (sprite, x) => prop(sprite, x, WALL_BASE - SPRITES[sprite].h);
  return [
    wall('window', 78, 58),
    wall('windowNote', 214, 58),
    wall('picLandscape', 282, 74),
    wall('flagUK', 330, 62),
    wall('picSunset', 140, 70),
    prop('door', 160, WALL_BASE - SPRITES.door.h, { z: 1 }),
    prop('door', 176, WALL_BASE - SPRITES.door.h, { z: 1, flip: true }),
    floorItem('vending', 4),
    floorItem('fridge', 30),
    floorItem('cooler', 58),
    floorItem('tableSmall', 110),
    prop('coffeeMaker', 114, WALL_BASE - SPRITES.tableSmall.h - 7, { z: WALL_BASE + 0.1 }),
    prop('mug', 126, WALL_BASE - SPRITES.tableSmall.h - 3, { z: WALL_BASE + 0.1 }),
    floorItem('plant', 141),
    floorItem('plant', 197),
    floorItem('couchOrange', 270),
    floorItem('binGreen', 310),
    floorItem('binRed', 321),
    floorItem('binBlue', 332),
  ];
}

const BOSS = Object.freeze({ tableX: 262, tableY: 160, chairX: 249 });

function bossArea() {
  const tableZ = BOSS.tableY + SPRITES.tableLong.h;
  const props = [
    prop('tableLong', BOSS.tableX, BOSS.tableY),
    prop('pc', BOSS.tableX + 1, BOSS.tableY - 10, { z: tableZ + 0.1 }),
    prop('phone', BOSS.tableX + 22, BOSS.tableY - 2, { z: tableZ + 0.1 }),
    prop('paperA', BOSS.tableX + 32, BOSS.tableY - 3, { z: tableZ + 0.1 }),
    prop('plant', 326, 140),
    prop('couchBlue', 232, 222),
    prop('couchGreen', 296, 222),
    prop('tableSmall', 266, 230),
    prop('plant', 232, 256),
    prop('plant', 322, 256),
  ];
  const chairY = BOSS.tableY - 7;
  const sit = { x: BOSS.chairX + SPRITES.chairRed.w / 2, y: chairY + SPRITES.chairRed.h - 1 };
  const seat = Object.freeze({
    side: 'left',
    chair: { x: BOSS.chairX, y: chairY, flip: false },
    deskX: BOSS.tableX,
    sit,
    exit: { x: 228, y: sit.y },
    facing: 1,
  });
  return { props, seat };
}

/**
 * Places that agents walk to on a break. `stand` is where their feet end up.
 * `approachX` (optional) is the column to walk down when the spot is off the wall lane.
 * @typedef {{ id: string, stand: { x: number, y: number }, approachX?: number, say: string[] }} Poi
 */
export const POIS = Object.freeze([
  { id: 'vending', stand: { x: 16, y: LANE_Y }, say: ['🍫', 'snack time', '🥤'] },
  { id: 'fridge', stand: { x: 42, y: LANE_Y }, say: ['🧃', 'who took my lunch?'] },
  { id: 'cooler', stand: { x: 63, y: LANE_Y }, say: ['💧', 'hydrate', 'glug glug'] },
  { id: 'window', stand: { x: 91, y: LANE_Y }, say: ['nice day', '☁️', '…'] },
  { id: 'coffee', stand: { x: 122, y: LANE_Y }, say: ['☕', 'need coffee', 'refill'] },
  { id: 'couch', stand: { x: 287, y: LANE_Y }, say: ['😌', 'five minutes', 'zz'] },
  { id: 'lounge', stand: { x: 280, y: 252 }, approachX: 218, say: ['sync?', '🤝', 'quick chat'] },
]);

/** Builds the full floor plan: static props, one seat per agent, and the pet spots. */
export function buildLayout(roster = ROSTER) {
  const podCount = Math.max(0, ...roster.map((a) => (a.pod === 'boss' ? -1 : a.pod))) + 1;
  const pods = Array.from({ length: podCount }, (_, i) => podOrigin(i));
  const boss = bossArea();

  const seats = roster.map((agent) => {
    if (agent.pod === 'boss') return { agentId: agent.id, ...boss.seat };
    const sideIndex = roster.filter((a) => a.pod === agent.pod).indexOf(agent);
    return { agentId: agent.id, ...seatFor(pods[agent.pod], sideIndex === 0 ? 'left' : 'right') };
  });

  const chairs = roster.map((agent, i) => {
    const { chair } = seats[i];
    return prop(CHAIR_BY_MODEL[agent.model] ?? 'chairGray', chair.x, chair.y, { flip: chair.flip });
  });

  const props = [
    ...wallProps(),
    ...pods.flatMap((origin, i) => podProps(i, origin)),
    ...boss.props,
    ...chairs,
  ];

  return Object.freeze({ world: WORLD, props, seats, pois: POIS });
}
