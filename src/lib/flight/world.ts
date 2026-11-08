import { DEG } from "./math";
import type { Checkpoint, Course, Gate, HitKind, Motion, Prim } from "./types";

export const GATE_POST = 0.07; // m, gate post and bar thickness

export interface BoxSolid {
  k: "box";
  x: number;
  y: number;
  z0: number;
  z1: number;
  hw: number;
  hd: number;
  c: number;
  s: number;
  kind: HitKind;
  col: string;
  gate?: number; // index of the race gate this belongs to
  pass?: boolean; // drawn, never hit
  win?: { fh: number; lit: boolean }; // ribbon windows: one band per floor of this height
}

export interface CylSolid {
  k: "cyl";
  x: number;
  y: number;
  z0: number;
  z1: number;
  r0: number;
  r1: number;
  diamond: boolean; // a 4-sided cone (roof): diamond footprint
  n: number; // sides, for drawing
  c: number;
  s: number;
  kind: HitKind;
  col: string;
  pass?: boolean;
}

/** A box that moves: its pose at any flight-clock time comes from `moverPose`, never from state. */
export interface MoverSolid {
  k: "mov";
  x: number; // rest pose centre
  y: number;
  z0: number;
  z1: number;
  hw: number;
  hd: number;
  hh: number;
  c: number; // rest yaw
  s: number;
  motion: Motion;
  kind: HitKind;
  col: string;
  pass?: boolean;
}

export type Solid = BoxSolid | CylSolid | MoverSolid;

// default colours, the same as the drawing uses
export const COLS = { box: "#d9d2c3", cyl: "#cfc8b8", trunk: "#bf8a4f", crown: "#6aa86b", roof: "#c96a4e", pole: "#8a8f93", gate: "#ece6d6", house: "#efe6d2" };

const box = (x: number, y: number, z: number, w: number, d: number, h: number, yaw: number, kind: HitKind, col: string = COLS.box): BoxSolid => ({
  k: "box",
  x,
  y,
  z0: z,
  z1: z + h,
  hw: w / 2,
  hd: d / 2,
  c: Math.cos(yaw * DEG),
  s: Math.sin(yaw * DEG),
  kind,
  col,
});

const mover = (p: Extract<Prim, { type: "mover" }>): MoverSolid => {
  const z = p.z ?? 0;
  return {
    k: "mov",
    x: p.x,
    y: p.y,
    z0: z,
    z1: z + p.h,
    hw: p.w / 2,
    hd: p.d / 2,
    hh: p.h / 2,
    c: Math.cos((p.yaw ?? 0) * DEG),
    s: Math.sin((p.yaw ?? 0) * DEG),
    motion: p.motion,
    kind: p.kind ?? "obstacle",
    col: p.col ?? COLS.box,
  };
};

const cyl = (x: number, y: number, z: number, r: number, r1: number, h: number, n: number, rot: number, kind: HitKind, col: string = COLS.cyl): CylSolid => ({
  k: "cyl",
  x,
  y,
  z0: z,
  z1: z + h,
  r0: r,
  r1,
  diamond: n === 4,
  n,
  c: Math.cos(rot * DEG),
  s: Math.sin(rot * DEG),
  kind,
  col,
});

/** Roof of a house: a 4-sided pyramid whose base covers the walls' corners. */
export function roofOf(p: Extract<Prim, { type: "house" }>) {
  const r = (Math.hypot(p.w, p.d) / 2) * 1.02;
  const h = p.roof ?? 0.45 * Math.min(p.w, p.d);
  return { r, h, rot: (p.yaw ?? 0) + 45 };
}

export function treeParts(h: number) {
  return { trunkR: 0.16, trunkH: 0.35 * h, crownR: Math.max(0.5, 0.22 * h), crownZ: 0.3 * h, crownH: 0.7 * h };
}

export function gateSolids(g: Gate, index = 0): BoxSolid[] {
  const z = g.z ?? 0;
  const col = g.col ?? COLS.gate;
  const half = g.w / 2 + GATE_POST / 2;
  const c = Math.cos(g.heading * DEG), s = Math.sin(g.heading * DEG);
  // posts sit across the heading: offset along the left normal (-s, c)
  const px = -s * half, py = c * half;
  const out: BoxSolid[] = [
    box(g.x + px, g.y + py, 0, GATE_POST, GATE_POST, z + g.h + GATE_POST, g.heading, "gate", col),
    box(g.x - px, g.y - py, 0, GATE_POST, GATE_POST, z + g.h + GATE_POST, g.heading, "gate", col),
    box(g.x, g.y, z + g.h, GATE_POST, g.w + 2 * GATE_POST, GATE_POST, g.heading, "gate", col),
  ];
  if (z > 0) out.push(box(g.x, g.y, z - GATE_POST, GATE_POST, g.w + 2 * GATE_POST, GATE_POST, g.heading, "gate", col));
  for (const o of out) o.gate = index;
  return out;
}

/** Collision solids for a course: scenery plus the race gates. */
export function buildSolids(course: Course): Solid[] {
  const out: Solid[] = [];
  for (const p of course.prims) {
    const from = out.length;
    switch (p.type) {
      case "box": {
        const b = box(p.x, p.y, p.z ?? 0, p.w, p.d, p.h, p.yaw ?? 0, p.kind ?? "obstacle", p.col);
        if (p.win) b.win = { fh: p.win, lit: !!p.lit };
        out.push(b);
        break;
      }
      case "mover":
        out.push(mover(p));
        break;
      case "house": {
        const b = box(p.x, p.y, 0, p.w, p.d, p.h, p.yaw ?? 0, p.kind ?? "building", p.col ?? COLS.house);
        if (p.win) b.win = { fh: p.win, lit: !!p.lit };
        out.push(b);
        const r = roofOf(p);
        out.push(cyl(p.x, p.y, p.h, r.r, 0, r.h, 4, r.rot, "roof", p.roofCol ?? COLS.roof));
        break;
      }
      case "cyl":
        out.push(cyl(p.x, p.y, p.z ?? 0, p.r, p.r1 ?? p.r, p.h, p.n ?? 14, p.rot ?? 0, p.kind ?? "obstacle", p.col));
        break;
      case "tree": {
        const t = treeParts(p.h ?? 3);
        out.push(cyl(p.x, p.y, 0, t.trunkR, t.trunkR, t.trunkH, 8, 0, "tree", COLS.trunk));
        out.push(cyl(p.x, p.y, t.crownZ, t.crownR, 0.03, t.crownH, 12, 0, "tree", p.col ?? COLS.crown));
        break;
      }
      case "pole":
        out.push(cyl(p.x, p.y, 0, p.r ?? 0.08, p.r ?? 0.08, p.h, 8, 0, p.kind ?? "pole", p.col ?? COLS.pole));
        break;
      default:
        break; // decals are flat
    }
    if (p.solid === false) for (let i = from; i < out.length; i++) out[i].pass = true;
  }
  course.gates.forEach((g, i) => out.push(...gateSolids(g, i)));
  return out;
}

/** Rotation about a unit axis (Rodrigues), as rows. */
function axisAngle(a: [number, number, number], th: number): number[] {
  const n = Math.hypot(a[0], a[1], a[2]) || 1;
  const x = a[0] / n, y = a[1] / n, z = a[2] / n;
  const c = Math.cos(th), s = Math.sin(th), k = 1 - c;
  return [c + x * x * k, x * y * k - z * s, x * z * k + y * s, y * x * k + z * s, c + y * y * k, y * z * k - x * s, z * x * k - y * s, z * y * k + x * s, c + z * z * k];
}

const turn = (t: number, period: number, phase = 0) => 2 * Math.PI * (t / period + phase);

/**
 * Where a moving box is at flight-clock time `t` (s): its centre and its local axes as the columns of a row-major
 * 3x3 (r[0], r[3], r[6] is the box's own x axis in the world). Pure in (solid, t).
 */
export function moverPose(o: MoverSolid, t: number): { c: [number, number, number]; r: number[] } {
  const rest = [o.c, -o.s, 0, o.s, o.c, 0, 0, 0, 1];
  let cx = o.x, cy = o.y, cz = (o.z0 + o.z1) / 2;
  let r = rest;
  const sp = o.motion.spin;
  if (sp) {
    const th = sp.sweep !== undefined ? sp.sweep * DEG * Math.sin(turn(t, sp.period, sp.phase)) : turn(t, sp.period, sp.phase);
    const q = axisAngle(sp.axis, th);
    const dx = cx - sp.pivot[0], dy = cy - sp.pivot[1], dz = cz - sp.pivot[2];
    cx = sp.pivot[0] + q[0] * dx + q[1] * dy + q[2] * dz;
    cy = sp.pivot[1] + q[3] * dx + q[4] * dy + q[5] * dz;
    cz = sp.pivot[2] + q[6] * dx + q[7] * dy + q[8] * dz;
    r = [0, 1, 2].flatMap((i) => [0, 1, 2].map((j) => q[i * 3] * rest[j] + q[i * 3 + 1] * rest[3 + j] + q[i * 3 + 2] * rest[6 + j]));
  }
  const sl = o.motion.slide;
  if (sl) {
    const k = 0.5 - 0.5 * Math.cos(turn(t, sl.period, sl.phase));
    cx += sl.to[0] * k;
    cy += sl.to[1] * k;
    cz += sl.to[2] * k;
  }
  return { c: [cx, cy, cz], r };
}

/** The axis-aligned box a moving solid sweeps through over a whole cycle: what a route planner must keep clear. */
export function sweptBox(o: MoverSolid): BoxSolid {
  const periods = [o.motion.slide?.period, o.motion.spin?.period].filter((p): p is number => !!p);
  const span = Math.max(...periods, 1);
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  const N = 96;
  for (let i = 0; i < N; i++) {
    const { c, r } = moverPose(o, (i / N) * span);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      const a = sx * o.hw, b = sy * o.hd, d = sz * o.hh;
      const x = c[0] + r[0] * a + r[1] * b + r[2] * d, y = c[1] + r[3] * a + r[4] * b + r[5] * d, z = c[2] + r[6] * a + r[7] * b + r[8] * d;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x);
      y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      z0 = Math.min(z0, z); z1 = Math.max(z1, z);
    }
  }
  return { k: "box", x: (x0 + x1) / 2, y: (y0 + y1) / 2, z0, z1, hw: (x1 - x0) / 2, hd: (y1 - y0) / 2, c: 1, s: 0, kind: o.kind, col: o.col };
}

/** The first solid the sphere (x, y, z, radius m) touches at flight-clock time `t`, or null. */
export function collide(solids: Solid[], x: number, y: number, z: number, m: number, t = 0): Solid | null {
  for (const o of solids) {
    if (o.pass) continue;
    if (o.k === "mov") {
      const { c, r } = moverPose(o, t);
      const dx = x - c[0], dy = y - c[1], dz = z - c[2];
      // the sphere in the box's own frame, then the distance to the nearest point of the box
      const lx = dx * r[0] + dy * r[3] + dz * r[6], ly = dx * r[1] + dy * r[4] + dz * r[7], lz = dx * r[2] + dy * r[5] + dz * r[8];
      const ex = Math.max(0, Math.abs(lx) - o.hw), ey = Math.max(0, Math.abs(ly) - o.hd), ez = Math.max(0, Math.abs(lz) - o.hh);
      if (ex * ex + ey * ey + ez * ez < m * m) return o;
      continue;
    }
    if (z < o.z0 - m || z > o.z1 + m) continue;
    const dx = x - o.x, dy = y - o.y;
    const lx = dx * o.c + dy * o.s, ly = -dx * o.s + dy * o.c;
    if (o.k === "box") {
      if (Math.abs(lx) < o.hw + m && Math.abs(ly) < o.hd + m) return o;
    } else {
      const k = Math.max(0, Math.min(1, (z - o.z0) / Math.max(1e-6, o.z1 - o.z0)));
      const r = o.r0 + (o.r1 - o.r0) * k;
      if (o.diamond ? Math.abs(lx) + Math.abs(ly) < r + m : lx * lx + ly * ly < (r + m) * (r + m)) return o;
    }
  }
  return null;
}

/** Did the segment a→b fly through the gate's opening along its heading? */
export function throughGate(g: Gate, a: [number, number, number], b: [number, number, number]): boolean {
  const c = Math.cos(g.heading * DEG), s = Math.sin(g.heading * DEG);
  const da = (a[0] - g.x) * c + (a[1] - g.y) * s;
  const db = (b[0] - g.x) * c + (b[1] - g.y) * s;
  if (!(da < 0 && db >= 0)) return false;
  const k = da / (da - db);
  const px = a[0] + (b[0] - a[0]) * k, py = a[1] + (b[1] - a[1]) * k, pz = a[2] + (b[2] - a[2]) * k;
  const lateral = -(px - g.x) * s + (py - g.y) * c;
  const z0 = g.z ?? 0;
  return Math.abs(lateral) < g.w / 2 && pz > z0 + 0.05 && pz < z0 + g.h;
}

/** Did the segment a→b pass the checkpoint (ring: crossed along the heading inside r; sphere: touched)? */
export function passCheckpoint(cp: Checkpoint, a: [number, number, number], b: [number, number, number], speed: number): boolean {
  if (cp.heading === undefined) {
    const d = Math.hypot(b[0] - cp.x, b[1] - cp.y, b[2] - cp.z);
    if (cp.land) return d < cp.r && b[2] < 0.3 && speed < 1.5;
    return d < cp.r;
  }
  const c = Math.cos(cp.heading * DEG), s = Math.sin(cp.heading * DEG);
  const da = (a[0] - cp.x) * c + (a[1] - cp.y) * s;
  const db = (b[0] - cp.x) * c + (b[1] - cp.y) * s;
  if (!(da < 0 && db >= 0)) return false;
  const k = da / (da - db);
  const px = a[0] + (b[0] - a[0]) * k, py = a[1] + (b[1] - a[1]) * k, pz = a[2] + (b[2] - a[2]) * k;
  const lateral = -(px - cp.x) * s + (py - cp.y) * c;
  return Math.hypot(lateral, pz - cp.z) < cp.r;
}
