// The downtown range: one 160 m city that several courses fly. Streets run on x = 40, 80, 120 and y = 40, 80, 120
// (12 m wide); the blocks between them carry the towers, a parking garage, a skybridge, a construction crane, an
// old brick facade with a window slot, a block with an open atrium and an overpass that makes a low tunnel. All
// positions are metres, x east and y north, and every number is fixed: the layout is data, not a generator seeded at
// run time, so every pilot, ghost and replay sees the same city.
//
// A craft's content file picks courses from here with cityCourses(); the titles and labels are text keys the craft's
// own i18n file translates (courses.downtown.*, courses.gauntlet.*, courses.stress.*).

import type { Course, Goal, RangePrim, RangeStressEvent } from '@/content/schema';

type Gate = Course['gates'][number];

const FIELD = 160;
const CEILING = 62;

const COL = {
  peach: '#e7c9a6',
  sand: '#e8dcc0',
  concrete: '#d9d2c3',
  concrete2: '#cfc8b8',
  dark: '#bdb6a6',
  blue: '#c9d6e8',
  blue2: '#b3c6e0',
  mint: '#cfe6d8',
  blush: '#f0cdd6',
  mustard: '#efd9a0',
  brick: '#d98d63',
  crane: '#f4b829',
  steel: '#8a8f93',
  red: '#cf5038',
  walk: '#e6e0d0',
  grass: '#c5deb0',
  water: '#b9d3e4',
} as const;

const FLOOR = 3.2; // m per floor, the window bands' spacing

const slab = (x0: number, x1: number, y0: number, y1: number, col: string): RangePrim => ({
  type: 'flat',
  x: (x0 + x1) / 2,
  y: (y0 + y1) / 2,
  w: x1 - x0,
  d: y1 - y0,
  col,
  ink: false,
});

/** A building: a box from the ground with ribbon windows on every floor. */
const tower = (x0: number, x1: number, y0: number, y1: number, h: number, col: string, z = 0): RangePrim => ({
  type: 'box',
  x: (x0 + x1) / 2,
  y: (y0 + y1) / 2,
  z,
  w: x1 - x0,
  d: y1 - y0,
  h,
  col,
  kind: 'building',
  win: FLOOR,
  lit: true,
});

const block = (x: number, y: number, w: number, d: number, h: number, col: string, kind: Extract<RangePrim, { type: 'box' }>['kind'] = 'obstacle', z = 0): RangePrim => ({
  type: 'box',
  x,
  y,
  z,
  w,
  d,
  h,
  col,
  kind,
});

const post = (x: number, y: number, h: number, r = 0.14, z = 0, col: string = COL.steel): RangePrim => ({ type: 'cyl', x, y, z, r, h, n: 8, col, kind: 'pole' });

const lamp = (x: number, y: number, dx = 0.8): RangePrim[] => [post(x, y, 5.4, 0.1), block(x + dx / 2, y, Math.abs(dx) + 0.3, 0.3, 0.25, '#f1e6b8', 'pole', 5.4)];

/** AC units and an antenna on a roof: where the flat top of a tower would otherwise be a bare slab. */
function roof(cx: number, cy: number, w: number, d: number, h: number, mast = 0): RangePrim[] {
  const out: RangePrim[] = [
    block(cx - w * 0.25, cy + d * 0.22, 2.6, 1.8, 1.3, COL.dark, 'roof', h),
    block(cx + w * 0.2, cy - d * 0.25, 2.0, 2.0, 1.1, COL.dark, 'roof', h),
  ];
  if (mast) out.push({ type: 'cyl', x: cx + w * 0.3, y: cy + d * 0.3, z: h, r: 0.1, h: mast, n: 6, col: '#6c6f72', kind: 'pole' });
  return out;
}

/** A rooftop water tank on four legs. */
function waterTower(cx: number, cy: number, h: number): RangePrim[] {
  const out: RangePrim[] = [{ type: 'cyl', x: cx, y: cy, z: h + 2.6, r: 1.9, h: 3, n: 12, col: '#b9946a', kind: 'tower' }];
  for (const [dx, dy] of [[-1.1, -1.1], [1.1, -1.1], [-1.1, 1.1], [1.1, 1.1]]) out.push({ type: 'cyl', x: cx + dx, y: cy + dy, z: h, r: 0.14, h: 2.7, n: 6, col: '#6c6f72', kind: 'tower' });
  return out;
}

const spin = (pivot: [number, number, number], axis: [number, number, number], period: number, extra: { phase?: number; sweep?: number } = {}) => ({ spin: { pivot, axis, period, ...extra } });

function layout(): RangePrim[] {
  const p: RangePrim[] = [];

  // pavement under the blocks, the south-west park and the plaza
  const BX: Array<[number, number]> = [[4, 34], [46, 74], [86, 114], [126, 150]];
  for (const [x0, x1] of BX) for (const [y0, y1] of BX) p.push(slab(x0 - 1, x1 + 1, y0 - 1, y1 + 1, COL.walk));
  p.push(slab(4, 34, 4, 34, COL.grass), slab(4, 34, 88, 112, '#d8e3c5'));
  p.push({ type: 'disc', x: 14, y: 27, r: 2.6, col: COL.water });

  // centre lines on the six streets
  for (const c of [40, 80, 120]) {
    for (let t = 8; t < FIELD - 8; t += 10) {
      p.push({ type: 'flat', x: c, y: t, w: 0.3, d: 4, col: '#f3efe3', ink: false });
      p.push({ type: 'flat', x: t, y: c, w: 4, d: 0.3, col: '#f3efe3', ink: false });
    }
  }

  // south-west park: trees round the pad
  for (const [x, y, h] of [[8, 8, 3.6], [30, 9, 3.2], [9, 30, 3], [31, 31, 3.4], [27, 24, 2.8], [8, 19, 3.1], [20, 8, 2.9]]) p.push({ type: 'tree', x, y, h });

  // hotel with a rooftop water tower, and a low annex
  p.push(tower(48, 72, 8, 30, 30, COL.peach), tower(48, 60, 30, 33, 9, COL.sand));
  p.push(...roof(60, 19, 24, 22, 30, 7), ...waterTower(67, 25, 30));

  // two towers with a 6 m alley between them
  p.push(tower(88, 100, 6, 32, 36, COL.blue), tower(106, 114, 6, 32, 26, COL.mint));
  p.push(...roof(94, 19, 12, 26, 36, 9), ...roof(110, 19, 8, 26, 26));

  // parking garage: four decks open at both ends, the second deck is the one the gate race flies along
  const G0 = [126, 150, 8, 30] as const;
  p.push(slab(G0[0], G0[1], G0[2], G0[3], COL.concrete2));
  for (const z of [3, 6.2, 9.4, 12.6]) {
    p.push({ type: 'box', x: 138, y: 19, z, w: 24, d: 22, h: 0.4, col: COL.concrete2, kind: 'building' });
    p.push(block(138, 8.2, 24, 0.4, 0.9, COL.dark, 'wall', z + 0.4), block(138, 29.8, 24, 0.4, 0.9, COL.dark, 'wall', z + 0.4));
  }
  for (const x of [128, 134, 140, 146, 149]) for (const y of [9, 29]) p.push(block(x, y, 0.7, 0.7, 12.6, COL.dark, 'pillar'));
  p.push(block(138, 19, 3, 3, 3, COL.dark, 'wall'));

  // offices west of the skybridge street, a billboard on the roof
  p.push(tower(6, 32, 48, 72, 20, COL.concrete), ...roof(19, 60, 26, 24, 20, 10));
  p.push(post(12, 60, 3, 0.15, 20), post(26, 60, 3, 0.15, 20), block(19, 60, 16, 0.5, 4.6, COL.mustard, 'wall', 22));

  // two towers joined by a skybridge over the street at x = 80
  p.push(tower(48, 72, 48, 72, 26, COL.blue2), tower(88, 112, 48, 72, 32, COL.blush));
  p.push({ type: 'box', x: 80, y: 60, z: 14, w: 16, d: 5, h: 3.2, col: COL.concrete, kind: 'building', win: 1.6 });
  p.push(...roof(60, 60, 24, 24, 26, 8), ...roof(100, 60, 24, 24, 32, 11));

  // covered market, lamp posts and a delivery truck at the kerb
  p.push(tower(128, 150, 48, 72, 8, COL.mustard));
  p.push(block(36.4, 54, 2.3, 6.4, 3.1, COL.red, 'obstacle'), block(36.4, 57.6, 2.3, 1.6, 2.2, '#e8e2d2', 'obstacle'));

  // billboard over the avenue y = 80
  p.push(post(104, 74.6, 13, 0.25), post(104, 85.4, 13, 0.25), block(104, 80, 0.7, 11.2, 4.6, '#f4b829', 'wall', 13));

  // cottages round a garden plaza: the gauntlet's pad stands in the middle
  p.push({ type: 'house', x: 11, y: 93, w: 8, d: 7, h: 6, col: COL.peach, roof: 3.5, win: 3 }, { type: 'house', x: 28, y: 93, w: 8, d: 7, h: 6, col: COL.mint, roof: 3.5, win: 3 });
  p.push({ type: 'house', x: 11, y: 108, w: 8, d: 7, h: 7, col: COL.mustard, roof: 3.5, win: 3 }, { type: 'house', x: 28, y: 108, w: 8, d: 7, h: 7, col: COL.blush, roof: 3.5, win: 3 });
  for (const [x, y] of [[19, 91], [19, 109], [8, 100], [31, 100]]) p.push({ type: 'tree', x, y, h: 3.4 });

  // atrium block: a ring of building round a 10 m open court, a door in the south wall, a service lift in the court
  const A = { x: 60, y: 100, h: 26 };
  p.push(
    tower(48, 55, 88, 112, A.h, COL.sand),
    tower(65, 72, 88, 112, A.h, COL.sand),
    tower(55, 58.5, 88, 95, A.h, COL.sand),
    tower(61.5, 65, 88, 95, A.h, COL.sand),
    tower(55, 65, 105, 112, A.h, COL.sand),
    block(60, 91.5, 3, 7, A.h - 3.4, COL.sand, 'building', 3.4),
  );
  p.push({ type: 'mover', x: 57.6, y: 102.4, z: 0.2, w: 2, d: 2, h: 2.4, col: COL.red, kind: 'door', motion: { slide: { to: [0, 0, 17], period: 9 } } });

  // construction site: mast, cab, a concrete frame and a crane whose jib sweeps the corner of the street
  const M: [number, number] = [94, 94];
  p.push(block(M[0], M[1], 1.6, 1.6, 34, COL.crane, 'crane'), block(M[0], M[1], 2.6, 2.6, 2.4, COL.crane, 'crane', 34));
  p.push({ type: 'mover', x: 103, y: M[1], z: 34.4, w: 30, d: 1.2, h: 1.2, col: COL.crane, kind: 'crane', motion: spin([M[0], M[1], 35], [0, 0, 1], 48, { sweep: 68 }) });
  p.push({ type: 'mover', x: 89, y: M[1], z: 33.4, w: 3.2, d: 2.4, h: 2.2, col: COL.steel, kind: 'crane', motion: spin([M[0], M[1], 35], [0, 0, 1], 48, { sweep: 68 }) });
  p.push({ type: 'mover', x: 110, y: M[1], z: 7.4, w: 0.14, d: 0.14, h: 27, col: '#3d3935', kind: 'crane', motion: spin([M[0], M[1], 35], [0, 0, 1], 48, { sweep: 68 }) });
  p.push({ type: 'mover', x: 110, y: M[1], z: 6.6, w: 1.1, d: 1.1, h: 0.8, col: COL.red, kind: 'crane', motion: spin([M[0], M[1], 35], [0, 0, 1], 48, { sweep: 68 }) });
  for (const x of [100, 104, 108]) for (const y of [102, 106, 110]) p.push(block(x, y, 0.6, 0.6, 12, COL.concrete2, 'pillar'));
  for (const z of [4, 8, 12]) p.push({ type: 'box', x: 104, y: 106, z, w: 10, d: 10, h: 0.3, col: COL.concrete2, kind: 'building' });
  p.push(block(90, 108, 4, 2.4, 2.6, COL.steel, 'obstacle'), block(96, 89, 2.4, 6, 0.9, COL.mustard, 'obstacle'));

  // landmark tower with a water tank and an antenna
  p.push(tower(128, 150, 88, 112, 48, COL.blue), ...roof(139, 100, 22, 24, 48, 10), ...waterTower(134, 105, 48));

  // brick facade with a window slot (2.2 m wide, 1.6 m high, 7 m up), rubble and scaffolding behind
  const W = { x: 19, y: 138, z: 7, h: 1.6 };
  p.push(block(19, W.y, 22, 1, 7, COL.brick, 'wall'), block(19, W.y, 22, 1, 7.4, COL.brick, 'wall', W.z + W.h));
  p.push(block(12.95, W.y, 9.9, 1, W.h, COL.brick, 'wall', W.z), block(25.05, W.y, 9.9, 1, W.h, COL.brick, 'wall', W.z));
  p.push(block(11, 143, 0.5, 0.5, 11, COL.steel, 'pole'), block(27, 143, 0.5, 0.5, 11, COL.steel, 'pole'), block(19, 143, 18, 0.4, 0.4, COL.steel, 'pole', 9));
  p.push(block(14, 146, 3, 2, 1.1, COL.dark, 'obstacle'), block(24, 145, 2.4, 3, 0.8, COL.dark, 'obstacle'));

  // office with a rooftop wind turbine
  p.push(tower(48, 72, 128, 150, 22, COL.mint), ...roof(60, 139, 24, 22, 22, 0));
  p.push(block(60, 139, 0.7, 0.7, 7.6, COL.concrete, 'tower', 22), block(60, 139, 1.2, 2.6, 1.1, COL.concrete, 'tower', 29.4));
  for (let i = 0; i < 3; i++) {
    p.push({ type: 'mover', x: 60, y: 137.6, z: 30.5, w: 0.55, d: 0.16, h: 6.5, col: '#eeeae0', kind: 'blade', motion: spin([60, 137.6, 30], [0, 1, 0], 4.2, { phase: i / 3 }) });
  }

  // tall tower with an antenna, a glass pavilion
  p.push(tower(88, 112, 128, 150, 34, COL.mint), ...roof(100, 139, 24, 22, 34, 16));
  p.push(tower(128, 150, 128, 150, 14, COL.blue), ...roof(139, 139, 22, 22, 14, 0));

  // overpass on the avenue y = 120: an 8 m tunnel, 2.6 m clear, 8.4 m wide
  p.push({ type: 'box', x: 102, y: 120, z: 2.6, w: 8, d: 10, h: 1.2, col: COL.concrete2, kind: 'building' });
  p.push(block(102, 115.5, 8, 0.6, 2.6, COL.dark, 'wall'), block(102, 124.5, 8, 0.6, 2.6, COL.dark, 'wall'));

  // slalom poles on the street x = 40 (north of the avenue y = 120)
  for (const [x, y] of [[37.6, 146], [42.4, 140], [37.6, 134], [42.4, 128]]) p.push(post(x, y, 6, 0.16, 0, '#ef6a4c'));

  // a delivery truck that drives along the avenue y = 40, and one parked at the kerb
  p.push({ type: 'mover', x: 124.5, y: 43.2, z: 0, w: 6.5, d: 2.4, h: 3.2, col: COL.mustard, kind: 'obstacle', motion: { slide: { to: [24, 0, 0], period: 16 } } });
  p.push(block(60, 77.2, 6.5, 2.4, 3.2, COL.blue2, 'obstacle'), block(66, 77.2, 2.2, 2.2, 2.2, '#e8e2d2', 'obstacle'));

  // a power line down the street x = 120: poles every 30 m, two wires a span at 10 m
  const line = [14, 44, 74, 104, 134];
  for (const y of line) p.push(post(124.4, y, 11, 0.2), block(124.4, y, 2.4, 0.2, 0.2, COL.steel, 'pole', 10.4));
  for (let i = 0; i < line.length - 1; i++) {
    const mid = (line[i] + line[i + 1]) / 2;
    for (const dx of [-0.9, 0.9]) p.push(block(124.4 + dx, mid, 0.07, line[i + 1] - line[i], 0.07, '#3d3935', 'wire', 10.4));
  }

  // lamp posts and street trees along the avenues
  for (const y of [40, 80, 120]) for (let x = 10; x < 154; x += 22) p.push(...lamp(x, y - 5.2, 0.8));
  for (const x of [40, 80]) for (let y = 14; y < 150; y += 22) if (y % 40 > 6 && y % 40 < 34) p.push(...lamp(x + 5.2, y, -0.8));
  for (const [x, y] of [[35.5, 90], [35.5, 118], [84.5, 30], [84.5, 92], [45, 100], [75, 100], [118, 56], [118, 90]]) p.push({ type: 'tree', x, y, h: 3.2 });

  return p;
}

/** Gate race: twelve gates, counter-clockwise nothing, clockwise everything, ~520 m a lap. */
const raceGates: Gate[] = [
  [40, 54, 90, 1.4],
  [40, 88, 90, 2.4],
  [56, 120, 0, 3.2],
  [102, 120, 0, 0.25, 2.1],
  [120, 106, 270, 2.2],
  [110, 80, 180, 3.5],
  [80, 61, 270, 4.5],
  [136, 19, 0, 3.55, 2.4],
  [156, 8, 270, 1.8],
  [112, 3, 180, 1.8],
  [103, 22, 90, 2],
  [72, 40, 180, 2.4],
];

const raceProps = { field: { w: FIELD, d: FIELD }, pad: [22, 20] as [number, number], ceiling: CEILING, ground: '#cdc7b9', gateSize: [2.8, 2.8] as [number, number], zoom: 36, sky: ['#aac7dd', '#f0ece0'] as [string, string], wind: { speed: 3.5, from: 200, gust: 3 } };

const gauntletGoals: Goal[] = [
  { x: 19, y: 138, z: 7.8, r: 0.6, heading: 90, label: 'courses.gauntlet.goals.1' },
  { x: 41.8, y: 146, z: 2, r: 1.25, heading: 270, label: 'courses.gauntlet.goals.2' },
  { x: 38.2, y: 140, z: 2, r: 1.25, heading: 270, label: 'courses.gauntlet.goals.3' },
  { x: 41.8, y: 134, z: 2, r: 1.25, heading: 270, label: 'courses.gauntlet.goals.4' },
  { x: 38.2, y: 128, z: 2, r: 1.25, heading: 270, label: 'courses.gauntlet.goals.5' },
  { x: 61.5, y: 98.5, z: 2.6, r: 2.1, label: 'courses.gauntlet.goals.6' },
  { x: 60, y: 90.5, z: 1.65, r: 1.25, heading: 270, label: 'courses.gauntlet.goals.7' },
  { x: 108, y: 97, z: 4.2, r: 1.6, label: 'courses.gauntlet.goals.8' },
  { x: 104, y: 120, z: 1.3, r: 1.05, heading: 180, label: 'courses.gauntlet.goals.9' },
  { x: 19, y: 100, z: 0, r: 1.5, land: true, label: 'courses.gauntlet.goals.10' },
];

const stressGoals: Goal[] = [
  { x: 40, y: 62, z: 5, r: 1.8, heading: 90, label: 'courses.stress.goals.1' },
  { x: 40, y: 100, z: 6, r: 1.8, heading: 90, label: 'courses.stress.goals.2' },
  { x: 62, y: 120, z: 6, r: 1.8, heading: 0, label: 'courses.stress.goals.3' },
  { x: 104, y: 120, z: 1.3, r: 1.05, heading: 0, label: 'courses.stress.goals.4' },
  { x: 120, y: 98, z: 6, r: 1.8, heading: 270, label: 'courses.stress.goals.5' },
  { x: 120, y: 56, z: 6, r: 1.8, heading: 270, label: 'courses.stress.goals.6' },
  { x: 80, y: 40, z: 5, r: 1.8, heading: 180, label: 'courses.stress.goals.7' },
  { x: 22, y: 20, z: 0, r: 1.5, land: true, label: 'courses.stress.goals.8' },
];

/** The schedule the stress test runs, seconds after arming. */
export const STRESS_EVENTS: RangeStressEvent[] = [
  { kind: 'gusts', at: 8, until: 95, level: 8 },
  { kind: 'night', at: 28, until: 80, level: 0.85 },
  { kind: 'sag', at: 40, until: 140, level: 2.2 },
  { kind: 'downdraft', at: 52, until: 66, level: 3 },
  { kind: 'fog', at: 58, until: 105, level: 0.8 },
  { kind: 'degrade', at: 72, until: 140, level: 0.7 },
];

export type CityId = 'downtown' | 'gauntlet' | 'stress';

/** Medal times differ by craft: a racer laps faster than a whoop. `speed` scales the quad5's. */
export function cityCourses(pick: CityId[], scale = 1): Course[] {
  const prims = layout();
  const par = (gold: number, silver: number, bronze: number) => ({ gold: Math.round(gold * scale), silver: Math.round(silver * scale), bronze: Math.round(bronze * scale) });
  const all: Record<CityId, Course> = {
    downtown: { id: 'downtown', kind: 'gates', title: 'courses.downtown.title', brief: 'courses.downtown.brief', ...raceProps, prims, gates: raceGates, goals: [], par: par(52, 68, 100) },
    gauntlet: {
      id: 'gauntlet',
      kind: 'checkpoints',
      title: 'courses.gauntlet.title',
      brief: 'courses.gauntlet.brief',
      ...raceProps,
      pad: [19, 100],
      prims,
      gates: [],
      goals: gauntletGoals,
      par: par(70, 95, 140),
    },
    stress: {
      id: 'stress',
      kind: 'checkpoints',
      title: 'courses.stress.title',
      brief: 'courses.stress.brief',
      ...raceProps,
      prims,
      gates: [],
      goals: stressGoals,
      par: par(100, 125, 150),
      stress: { limit: 150, events: STRESS_EVENTS },
    },
  };
  return pick.map((id) => all[id]);
}
