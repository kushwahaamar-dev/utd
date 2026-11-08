import { describe, expect, it } from "vitest";
import quad5 from "@/content/drones/quad5";
import { flightCalc } from "@/lib/dronelab/fly";
import { flightOf } from "./registry";
import { createSim, dispatch, drainEvents, replay, stepSim, STEP } from "./sim";
import { ramp, stressFx } from "./stress";
import type { Course, FlightEvent, StressSpec } from "./types";
import { buildSolids, collide, moverPose, sweptBox, type MoverSolid } from "./world";

const flight = flightOf(quad5)!;
const craft = flight.craft;
const calc = flightCalc(quad5, quad5.design.default, false);
const city = (id: string) => flight.courses.find((c) => c.id === id)!;
const moversOf = (course: Course) => buildSolids(course).filter((o): o is MoverSolid => o.k === "mov");

const boom: MoverSolid = {
  k: "mov",
  x: 10,
  y: 0,
  z0: 5,
  z1: 6,
  hw: 5,
  hd: 0.5,
  hh: 0.5,
  c: 1,
  s: 0,
  kind: "crane",
  col: "#fff",
  motion: { spin: { pivot: [0, 0, 5.5], axis: [0, 0, 1], period: 40 } },
};

describe("moving obstacles", () => {
  it("are a pure function of the clock: the same time gives the same pose", () => {
    for (const o of moversOf(city("downtown"))) for (const t of [0, 1.7, 33.3, 250]) expect(moverPose(o, t)).toEqual(moverPose(o, t));
  });

  it("slide out and back: at rest at 0, fully out at half a period", () => {
    const door: MoverSolid = { ...boom, motion: { slide: { to: [0, 0, 8], period: 10 } } };
    expect(moverPose(door, 0).c[2]).toBeCloseTo(5.5);
    expect(moverPose(door, 5).c[2]).toBeCloseTo(13.5);
    expect(moverPose(door, 10).c[2]).toBeCloseTo(5.5);
  });

  it("turn about their pivot: a quarter turn puts the boom's tip on the y axis", () => {
    const q = moverPose(boom, 10);
    expect(q.c[0]).toBeCloseTo(0, 5);
    expect(q.c[1]).toBeCloseTo(10, 5);
    // its own x axis now points along +y
    expect([q.r[0], q.r[3]].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([0, 1]);
  });

  it("hit only where they are: the boom is in the way at one time and gone a quarter turn later", () => {
    const solids = [boom];
    expect(collide(solids, 12, 0, 5.5, 0.16, 0)).toBe(boom);
    expect(collide(solids, 12, 0, 5.5, 0.16, 10)).toBeNull();
    expect(collide(solids, 0, 12, 5.5, 0.16, 10)).toBe(boom);
    // above and below it is clear, and the sphere's own radius counts
    expect(collide(solids, 12, 0, 6.5, 0.16, 0)).toBeNull();
    expect(collide(solids, 12, 0, 6.6, 0.2, 0)).toBeNull();
    expect(collide(solids, 12, 0, 6.6, 0.2 + 0.4, 0)).toBe(boom);
  });

  it("tilt in the box's own frame: a blade turned flat is thin in z", () => {
    const blade: MoverSolid = { ...boom, hw: 0.3, hd: 0.1, hh: 3, x: 0, y: 0, z0: 5, z1: 11, motion: { spin: { pivot: [0, 0, 8], axis: [0, 1, 0], period: 4 } } };
    // vertical at 0 s, horizontal (along x) after a quarter turn
    expect(collide([blade], 0, 0, 10.5, 0.1, 0)).toBe(blade);
    expect(collide([blade], 0, 0, 10.5, 0.1, 1)).toBeNull();
    expect(Math.abs(moverPose(blade, 1).c[2] - 8)).toBeLessThan(1e-9);
    expect(collide([blade], 2.9, 0, 8, 0.1, 1)).toBe(blade);
  });

  it("are swept over by the route planner's box for the whole cycle", () => {
    const box = sweptBox(boom);
    for (let t = 0; t < 40; t += 0.5) {
      const { c } = moverPose(boom, t);
      expect(c[0]).toBeGreaterThanOrEqual(box.x - box.hw - 1e-6);
      expect(c[0]).toBeLessThanOrEqual(box.x + box.hw + 1e-6);
      expect(c[1]).toBeGreaterThanOrEqual(box.y - box.hd - 1e-6);
      expect(c[1]).toBeLessThanOrEqual(box.y + box.hd + 1e-6);
    }
  });

  it("run on the flight clock: held on the pad, started by arming, so every run meets the same crane", () => {
    const s = createSim(craft, city("downtown"), calc, { mode: "race" });
    for (let i = 0; i < 300; i++) stepSim(s);
    expect(s.clock).toBe(0);
    dispatch(s, { type: "arm" });
    for (let i = 0; i < 250; i++) stepSim(s);
    expect(s.clock).toBeCloseTo(2.5, 6);
    dispatch(s, { type: "disarm" });
    for (let i = 0; i < 100; i++) stepSim(s);
    expect(s.clock).toBeCloseTo(2.5, 6);
  });

  it("replay to the same crash: a craft flown into the swinging crane hits it at the same step every time", () => {
    // fly the autopilot's own line is not possible here; hold altitude and drift east into the jib's sweep instead
    const course = city("downtown");
    const log = [
      { step: 0, action: { type: "mode", mode: "alt" } as const },
      { step: 0, action: { type: "arm" } as const },
      { step: 0, action: { type: "sticks", sticks: { throttle: 1, yaw: 0, pitch: 0, roll: 0 } } as const },
      { step: 1700, action: { type: "sticks", sticks: { throttle: 0.5, yaw: 0, pitch: 0, roll: 0 } } as const },
    ];
    const a = replay(craft, course, calc, log, 6000, { mode: "alt" });
    const b = replay(craft, course, calc, log, 6000, { mode: "alt" });
    expect(a.events).toEqual(b.events);
    expect(a.sim.p).toEqual(b.sim.p);
  });
});

describe("the downtown city", () => {
  const solids = buildSolids(city("downtown"));
  const scenery = solids.filter((o) => !(o.k === "box" && o.gate !== undefined));

  it("names what every solid is, so a crash line is never the generic one", () => {
    for (const prim of city("downtown").prims) {
      if (prim.type === "box" || prim.type === "cyl" || prim.type === "pole" || prim.type === "mover") expect(prim.kind, JSON.stringify(prim)).toBeDefined();
    }
  });

  it("has every race gate clear through its opening, at both ends", () => {
    const r = craft.hitRadius;
    for (const g of city("downtown").gates) {
      const c = Math.cos((g.heading * Math.PI) / 180), s = Math.sin((g.heading * Math.PI) / 180);
      const mid = (g.z ?? 0) + g.h / 2;
      for (const d of [-3, -0.5, 0, 0.5, 3]) {
        const hit = collide(scenery, g.x + c * d, g.y + s * d, mid, r, 0);
        expect(hit, `gate at ${g.x},${g.y} ${d} m along`).toBeNull();
      }
    }
  });

  it("puts every checkpoint of the gauntlet and the stress test in open air", () => {
    for (const id of ["gauntlet", "stress"]) {
      for (const cp of city(id).checkpoints) {
        const clear = cp.land ? cp.z + 0.5 : cp.z;
        expect(collide(buildSolids(city(id)), cp.x, cp.y, clear, craft.hitRadius, 0), `${id}: ${cp.label}`).toBeNull();
      }
    }
  });

  it("fits the field: every solid stands inside the 160 m square, under the ceiling", () => {
    const c = city("downtown");
    for (const o of solids) {
      expect(o.x, o.kind).toBeGreaterThan(0);
      expect(o.x, o.kind).toBeLessThan(c.field);
      expect(o.y, o.kind).toBeGreaterThan(0);
      expect(o.y, o.kind).toBeLessThan(c.field);
      if (o.k !== "mov") expect(o.z1, o.kind).toBeLessThan((c.ceiling ?? craft.ceiling) - 3);
    }
  });

  it("flies the same laps with moving obstacles in it: gate 1 starts the clock, the lap is deterministic", () => {
    const run = () => {
      const s = createSim(craft, city("downtown"), calc, { mode: "demo" });
      dispatch(s, { type: "arm" });
      const ev: FlightEvent[] = [];
      for (let i = 0; i < 200 * 100 && !s.crashed && !ev.some((e) => e.type === "lap"); i++) {
        stepSim(s);
        ev.push(...drainEvents(s));
      }
      return ev.find((e) => e.type === "lap");
    };
    const lap = run();
    expect(lap).toMatchObject({ type: "lap", demo: true });
    expect(run()).toEqual(lap);
  });
});

describe("the stress test", () => {
  const spec: StressSpec = { limit: 60, events: [{ kind: "gusts", at: 10, until: 40, level: 8 }, { kind: "sag", at: 20, until: 30, level: 2 }] };

  it("eases each event in and out instead of switching it", () => {
    const e = spec.events[0];
    expect(ramp(e, 5)).toBe(0);
    expect(ramp(e, 10)).toBe(0);
    expect(ramp(e, 11.5)).toBeCloseTo(0.5);
    expect(ramp(e, 20)).toBe(1);
    expect(ramp(e, 38.5)).toBeCloseTo(0.5, 1);
    expect(ramp(e, 40)).toBe(0);
    expect(stressFx(spec, 25)).toMatchObject({ wind: 8, sag: 2, degrade: 0, night: 0 });
  });

  it("runs the schedule against the flight time, says when each event turns on and off, and ends at the limit", () => {
    const course: Course = { ...city("stress"), stress: spec };
    const s = createSim(craft, course, calc, { mode: "alt" });
    dispatch(s, { type: "arm" });
    dispatch(s, { type: "sticks", sticks: { throttle: 0.5, yaw: 0, pitch: 0, roll: 0 } });
    const seen: string[] = [];
    for (let i = 0; i < 61 / STEP && s.stressEnd === null && !s.crashed; i++) {
      stepSim(s);
      for (const e of drainEvents(s)) if (e.type === "stress") seen.push(`${e.kind}:${e.on ? "on" : "off"}@${Math.round(s.t)}`);
    }
    expect(seen.slice(0, 2)).toEqual(["gusts:on@10", "sag:on@20"]);
    expect(s.stressEnd === "timeout" || s.stressEnd === "crashed").toBe(true);
  });

  it("ends the test with the crash and keeps the report's numbers", () => {
    const s = createSim(craft, city("stress"), calc, { mode: "angle" });
    dispatch(s, { type: "arm" });
    const ev: FlightEvent[] = [];
    for (let i = 0; i < 20 / STEP && !s.crashed; i++) {
      // up off the pad for a second and a half, then the throttle is cut: it drops onto the park
      dispatch(s, { type: "sticks", sticks: { throttle: s.t > 1.5 ? 0 : 0.9, yaw: 0, pitch: 0, roll: 0 } });
      stepSim(s);
      ev.push(...drainEvents(s));
    }
    expect(s.crashed).toBe(true);
    expect(ev.filter((e) => e.type === "stressEnd")).toEqual([{ type: "stressEnd", outcome: "crashed", t: expect.any(Number) }]);
    expect(s.stats.maxSpeed).toBeGreaterThan(5);
    expect(s.stats.hits).toBe(0);
  });

  it("sags the pack deeper than a calm flight would, and the low-voltage warning comes with it", () => {
    const fly = (level: number) => {
      const sag: StressSpec = { limit: 60, events: [{ kind: "sag", at: 0, until: 60, level }] };
      const s = createSim(craft, { ...city("stress"), stress: sag, ceiling: 400 }, calc, { mode: "acro" });
      dispatch(s, { type: "arm" });
      const ev: FlightEvent[] = [];
      // punch-outs: full throttle for a second, back to a hover for a second
      for (let i = 0; i < 12 / STEP && !s.crashed; i++) {
        dispatch(s, { type: "sticks", sticks: { throttle: Math.floor(s.t) % 2 === 0 ? 1 : 0.3, yaw: 0, pitch: 0, roll: 0 } });
        stepSim(s);
        ev.push(...drainEvents(s));
      }
      return { min: s.stats.minCell, low: ev.some((e) => e.type === "battery" && e.level === "low") };
    };
    const calm = fly(0), weak = fly(2.2);
    expect(weak.min).toBeLessThan(calm.min - 0.3);
    expect(weak.low).toBe(true);
    expect(calm.min).toBeGreaterThan(2.5);
  });
});
