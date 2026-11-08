// The workshop of the landing hero: a bench under a window, drawn procedurally in a 192 x 120 space at 2x. GlyphScene
// samples the result into glyphs. `t` is the time of day (0 dawn, 1/3 noon, 2/3 dusk, 1 night), `time` is seconds.
//
// The scene is layered so that dragging the slider only re-renders the static layers and each frame only the moving
// parts: sky, landscape and room are cached canvases; clouds, stars, the monitor, LEDs, smoke and the drone are drawn live.

export const SCENE_W = 192;
export const SCENE_H = 120;
const SCALE = 2;

type RGB = [number, number, number];
type Ctx = CanvasRenderingContext2D;

const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a: RGB, b: RGB, k: number): RGB => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const mul = (a: RGB, b: RGB): RGB => [(a[0] * b[0]) / 255, (a[1] * b[1]) / 255, (a[2] * b[2]) / 255];
const rgba = (c: RGB, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (a: number, b: number, v: number) => {
  const k = clamp01((v - a) / (b - a));
  return k * k * (3 - 2 * k);
};

type Sky = { t: number; top: RGB; mid: RGB; bottom: RGB; ambient: RGB; night: number; sun: RGB };

const SKIES: Sky[] = [
  { t: 0, top: hex("#4a4a9e"), mid: hex("#e0809e"), bottom: hex("#ffb98a"), ambient: hex("#f0cbc4"), night: 0.2, sun: hex("#ffd9a0") },
  { t: 0.33, top: hex("#3a86dc"), mid: hex("#78b8f0"), bottom: hex("#c4e8ff"), ambient: hex("#fff8ee"), night: 0, sun: hex("#fff6d0") },
  { t: 0.66, top: hex("#3c3487"), mid: hex("#c4549a"), bottom: hex("#ffa04c"), ambient: hex("#ffc08e"), night: 0.35, sun: hex("#ffb060") },
  { t: 1, top: hex("#060b2a"), mid: hex("#16245c"), bottom: hex("#2a428c"), ambient: hex("#7083c4"), night: 1, sun: hex("#ffb060") },
];

function skyAt(t: number): Sky {
  const clamped = clamp01(t);
  let i = 0;
  while (i < SKIES.length - 2 && clamped > SKIES[i + 1].t) i++;
  const a = SKIES[i];
  const b = SKIES[i + 1];
  const k = smooth(0, 1, (clamped - a.t) / (b.t - a.t));
  return {
    t: clamped,
    top: mix(a.top, b.top, k),
    mid: mix(a.mid, b.mid, k),
    bottom: mix(a.bottom, b.bottom, k),
    ambient: mix(a.ambient, b.ambient, k),
    night: a.night + (b.night - a.night) * k,
    sun: mix(a.sun, b.sun, k),
  };
}

const WIN = { x: 12, y: 8, w: 70, h: 62 };
const HORIZON = 60;
const BENCH_TOP = 88;

function rect(ctx: Ctx, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function round(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, color: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

function glow(ctx: Ctx, x: number, y: number, r: number, color: RGB, alpha: number) {
  if (alpha <= 0.01) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(color, alpha));
  g.addColorStop(0.45, rgba(color, alpha * 0.35));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

function newLayer() {
  const canvas = document.createElement("canvas");
  canvas.width = SCENE_W * SCALE;
  canvas.height = SCENE_H * SCALE;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.scale(SCALE, SCALE);
    ctx.imageSmoothingEnabled = true;
  }
  return { canvas, ctx };
}

function sunPosition(t: number) {
  const p = t / 0.7;
  return { x: WIN.x + 8 + p * (WIN.w - 16), y: HORIZON + 2 - Math.sin(Math.min(p, 1.2) * Math.PI) * 44 };
}

function drawSky(ctx: Ctx, sky: Sky) {
  const { x, y, w, h } = WIN;
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, rgba(sky.top));
  g.addColorStop(0.5, rgba(sky.mid));
  g.addColorStop(0.92, rgba(sky.bottom));
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);

  const sun = sunPosition(sky.t);
  const sunAlpha = 1 - smooth(0.7, 0.84, sky.t);
  glow(ctx, sun.x, sun.y, 34, sky.sun, 0.55 * sunAlpha);
  glow(ctx, sun.x, HORIZON, 46, mix(sky.sun, sky.bottom, 0.5), 0.35 * sunAlpha);
  ctx.fillStyle = rgba(mix(sky.sun, [255, 255, 255], 0.55), sunAlpha);
  ctx.beginPath();
  ctx.arc(sun.x, sun.y, 4.4, 0, Math.PI * 2);
  ctx.fill();

  const moon = smooth(0.7, 0.92, sky.t);
  if (moon > 0) {
    const k = clamp01((sky.t - 0.7) / 0.3);
    const mx = x + 14 + k * (w - 30);
    const my = y + 22 - Math.sin(k * Math.PI) * 9;
    glow(ctx, mx, my, 20, hex("#9db4ff"), 0.4 * moon);
    ctx.fillStyle = `rgba(244,246,255,${moon})`;
    ctx.beginPath();
    ctx.arc(mx, my, 4.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = rgba(mix(sky.top, sky.mid, 0.4), moon);
    ctx.beginPath();
    ctx.arc(mx + 2.2, my - 1.1, 3.9, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawLandscape(ctx: Ctx, sky: Sky) {
  const { x, y, w, h } = WIN;
  const dim = 1 - sky.night * 0.78;
  const tone = (base: string, haze: number) => {
    const lit = mul(hex(base), mix([255, 255, 255], sky.ambient, 0.85));
    return rgba(mix(mix(lit, sky.bottom, haze), [6, 10, 26], (1 - dim) * 0.85));
  };

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();

  ctx.fillStyle = tone("#5d7a9a", 0.5);
  ctx.beginPath();
  ctx.moveTo(x, HORIZON + 1);
  ctx.bezierCurveTo(x + 14, HORIZON - 9, x + 24, HORIZON - 8, x + 36, HORIZON - 2);
  ctx.bezierCurveTo(x + 48, HORIZON - 12, x + 60, HORIZON - 8, x + w, HORIZON - 3);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.fill();

  ctx.fillStyle = tone("#38624a", 0.22);
  ctx.beginPath();
  ctx.moveTo(x, HORIZON + 4);
  ctx.bezierCurveTo(x + 18, HORIZON - 3, x + 30, HORIZON + 6, x + 46, HORIZON + 3);
  ctx.bezierCurveTo(x + 58, HORIZON, x + 66, HORIZON + 2, x + w, HORIZON - 1);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.fill();

  const pine = tone("#1f4634", 0.08);
  const pines: [number, number, number][] = [[x + 9, HORIZON + 1, 10], [x + 15, HORIZON + 2, 7], [x + 58, HORIZON - 1, 9], [x + 64, HORIZON, 12], [x + 68, HORIZON + 1, 7]];
  for (const [px, py, size] of pines) {
    ctx.fillStyle = pine;
    for (let layer = 0; layer < 3; layer++) {
      const top = py - size + layer * (size / 3.2);
      const half = 1.6 + layer * 1.5 + size * 0.08;
      ctx.beginPath();
      ctx.moveTo(px, top);
      ctx.lineTo(px - half, top + size / 2.4);
      ctx.lineTo(px + half, top + size / 2.4);
      ctx.fill();
    }
  }

  // a little house on the far hill, lit at dusk
  const hx = x + 40;
  const hy = HORIZON - 3;
  ctx.fillStyle = tone("#d8cdb8", 0.28);
  ctx.fillRect(hx, hy - 4, 6, 4);
  ctx.fillStyle = tone("#8c4a3a", 0.2);
  ctx.beginPath();
  ctx.moveTo(hx - 1, hy - 4);
  ctx.lineTo(hx + 3, hy - 7);
  ctx.lineTo(hx + 7, hy - 4);
  ctx.fill();
  const lit = smooth(0.3, 0.8, sky.night);
  if (lit > 0) {
    ctx.fillStyle = `rgba(255,205,120,${lit})`;
    ctx.fillRect(hx + 2, hy - 3, 2, 1.6);
  }
  ctx.restore();
}

function drawRoom(ctx: Ctx, sky: Sky) {
  const { x, y, w, h } = WIN;

  const wall = ctx.createLinearGradient(0, 0, 0, BENCH_TOP);
  wall.addColorStop(0, "#5a6f8a");
  wall.addColorStop(1, "#4a5f7b");
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, SCENE_W, BENCH_TOP);
  ctx.fillStyle = "rgba(20,30,50,0.09)";
  for (let px = 6; px < SCENE_W; px += 12) ctx.fillRect(px, 0, 0.7, BENCH_TOP);

  // window: frame, muntins, sill
  round(ctx, x - 3, y - 3, w + 6, h + 6, 1.5, "#c28a56");
  round(ctx, x - 4, y + h, w + 8, 4.5, 1, "#e2ab72");
  rect(ctx, x - 4, y + h + 4, w + 8, 1, "rgba(0,0,0,0.25)");
  // framed layout on the wall
  round(ctx, 96, 11, 32, 25, 1, "#2e2318");
  rect(ctx, 98, 13, 28, 21, "#0f6f5a");
  ctx.strokeStyle = "#d8b45a";
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(100, 18);
  ctx.lineTo(110, 18);
  ctx.lineTo(113, 22);
  ctx.lineTo(124, 22);
  ctx.moveTo(100, 26);
  ctx.lineTo(106, 26);
  ctx.lineTo(109, 30);
  ctx.lineTo(124, 30);
  ctx.moveTo(114, 14);
  ctx.lineTo(114, 33);
  ctx.stroke();
  for (const [dx, dy] of [[100, 18], [124, 22], [100, 26], [124, 30]]) {
    ctx.fillStyle = "#e8c66e";
    ctx.beginPath();
    ctx.arc(dx, dy, 1, 0, Math.PI * 2);
    ctx.fill();
  }

  // shelf with parts
  round(ctx, 134, 42, 54, 2.4, 0.8, "#c28a56");
  const crates = ["#ef6a4c", "#76a0e2", "#f4b829", "#93d3b0", "#f3a6bb", "#ef6a4c"];
  crates.forEach((color, i) => {
    const cx = 136 + i * 8.6;
    const ch = 9 + (i % 3) * 2;
    round(ctx, cx, 42 - ch, 7, ch, 1, color);
    rect(ctx, cx + 1.4, 42 - ch + 2, 4.2, 2, "rgba(255,255,255,0.7)");
  });
  rect(ctx, 150, 20, 4, 14, "#8a5a34");
  rect(ctx, 155, 18, 4, 16, "#d49c1f");
  rect(ctx, 160, 21, 3.5, 13, "#4f8fb8");

  // bench
  rect(ctx, 0, BENCH_TOP, SCENE_W, 7, "#c9915a");
  rect(ctx, 0, BENCH_TOP, SCENE_W, 1.3, "#e7b787");
  rect(ctx, 0, BENCH_TOP + 7, SCENE_W, SCENE_H - BENCH_TOP - 7, "#7a4e30");
  rect(ctx, 0, BENCH_TOP + 7, SCENE_W, 1.5, "rgba(0,0,0,0.35)");
  for (let dx = 6; dx < SCENE_W; dx += 62) {
    round(ctx, dx, BENCH_TOP + 12, 54, 16, 1.5, "#8b5c39");
    rect(ctx, dx + 21, BENCH_TOP + 18, 12, 2.4, "#d9c9ac");
  }

  drawArduino(ctx);
  drawBreadboard(ctx);
  drawIron(ctx);
  drawMonitorBody(ctx);
  drawLampBody(ctx);

  // everything but the window sits in the room's ambient light
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = rgba(sky.ambient);
  ctx.fillRect(0, 0, SCENE_W, SCENE_H);
  ctx.restore();

  // the window opens onto the sky layers; its muntins and the plant are tinted by hand
  const lit = (color: string) => rgba(mul(hex(color), sky.ambient));
  ctx.clearRect(WIN.x, WIN.y, WIN.w, WIN.h);
  rect(ctx, WIN.x + WIN.w / 2 - 1, WIN.y, 2, WIN.h, lit("#c28a56"));
  rect(ctx, WIN.x, WIN.y + 29, WIN.w, 2, lit("#c28a56"));
  rect(ctx, WIN.x + WIN.w / 2 - 1, WIN.y, 0.6, WIN.h, "rgba(255,255,255,0.25)");
  round(ctx, WIN.x + WIN.w - 12, WIN.y + WIN.h - 5, 8, 5, 1, lit("#c8562f"));
  ctx.fillStyle = lit("#3a8a52");
  for (const [lx, ly, r] of [[-3, -7, 4], [3, -9, 4.6], [0, -5, 3.6], [6, -5, 3.2]]) {
    ctx.beginPath();
    ctx.ellipse(WIN.x + WIN.w - 8 + lx, WIN.y + WIN.h + ly, r * 0.75, r, lx * 0.15, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawArduino(ctx: Ctx) {
  const x = 8;
  const y = 77;
  round(ctx, x + 6, y + 3, 44, 12.5, 1.2, "#0b7f94");
  round(ctx, x + 6, y + 3, 44, 1.4, 1, "#17a8bd");
  round(ctx, x, y + 4.5, 11, 6.4, 0.8, "#c4cbcf");
  rect(ctx, x + 1.2, y + 5.6, 8, 4.2, "#8a949a");
  round(ctx, x + 1, y + 11.5, 9, 4, 0.8, "#15181b");
  rect(ctx, x + 14, y + 4.2, 33, 2, "#14181b");
  rect(ctx, x + 14, y + 12.2, 33, 2, "#14181b");
  ctx.fillStyle = "#d8b45a";
  for (let i = 0; i < 16; i++) {
    ctx.fillRect(x + 15 + i * 2, y + 4.8, 0.8, 0.8);
    ctx.fillRect(x + 15 + i * 2, y + 12.8, 0.8, 0.8);
  }
  round(ctx, x + 23, y + 7.2, 14, 4.6, 0.6, "#12161a");
  ctx.fillStyle = "#4a5359";
  for (let i = 0; i < 7; i++) {
    ctx.fillRect(x + 24 + i * 1.8, y + 6.6, 0.6, 0.7);
    ctx.fillRect(x + 24 + i * 1.8, y + 11.8, 0.6, 0.7);
  }
  round(ctx, x + 14, y + 7.5, 3.4, 3.4, 0.8, "#ef6a4c");
  rect(ctx, x + 39, y + 8, 5, 2.2, "#c6ccce");
  rect(ctx, x + 19, y + 8.5, 2, 1.4, "#e7e2d4");
}

function drawBreadboard(ctx: Ctx) {
  const x = 62;
  const y = 77;
  round(ctx, x, y + 2, 40, 13.5, 1, "#e9e3d2");
  rect(ctx, x, y + 8, 40, 1.8, "#cfc8b3");
  rect(ctx, x + 1.5, y + 3.2, 37, 0.5, "#ef6a4c");
  rect(ctx, x + 1.5, y + 14.2, 37, 0.5, "#3d6fd1");
  ctx.fillStyle = "#8f8a7c";
  for (let i = 0; i < 17; i++) {
    for (const dy of [5.2, 6.6, 11, 12.4]) ctx.fillRect(x + 2.6 + i * 2.2, y + dy, 0.8, 0.8);
  }
  // resistor, button, LED socket
  rect(ctx, x + 8, y + 5.3, 5.5, 1.6, "#d9b78c");
  rect(ctx, x + 9.4, y + 5.3, 0.6, 1.6, "#b0382b");
  rect(ctx, x + 11, y + 5.3, 0.6, 1.6, "#2a2a2a");
  round(ctx, x + 22, y + 10.6, 4.5, 3.8, 0.6, "#2b3036");
  rect(ctx, x + 23.2, y + 11.4, 2.1, 2.1, "#8a949a");
  rect(ctx, x + 32, y + 5.8, 0.6, 1.6, "#bfc4c7");
}

function drawIron(ctx: Ctx) {
  round(ctx, 104, 86, 12, 2.8, 1, "#262b30");
  ctx.strokeStyle = "#8f989b";
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(108, 86);
  ctx.bezierCurveTo(105, 82, 111, 82, 108, 78);
  ctx.stroke();
  ctx.strokeStyle = "#1f2327";
  ctx.lineWidth = 2.6;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(116, 76.5);
  ctx.lineTo(122, 80.4);
  ctx.stroke();
  ctx.strokeStyle = "#ef6a4c";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(110, 79.6);
  ctx.lineTo(116, 76.7);
  ctx.stroke();
  ctx.strokeStyle = "#c6ccce";
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(110, 79.6);
  ctx.lineTo(107.6, 80.6);
  ctx.stroke();
  ctx.lineCap = "butt";
}

const MON = { x: 122, y: 52, w: 42, h: 30 };

function drawMonitorBody(ctx: Ctx) {
  const { x, y, w, h } = MON;
  rect(ctx, x + w / 2 - 3, y + h, 6, 6, "#2a3036");
  round(ctx, x + w / 2 - 11, BENCH_TOP - 2, 22, 2.6, 1, "#2a3036");
  round(ctx, x, y, w, h, 2, "#1b2127");
  rect(ctx, x + 2, y + 2, w - 4, h - 5, "#06120d");
  rect(ctx, x + w / 2 - 1.5, y + h - 2.4, 3, 0.9, "#8f989b");
}

function drawLampBody(ctx: Ctx) {
  round(ctx, 174, 86, 16, 3.4, 1.5, "#222a30");
  ctx.strokeStyle = "#2c353c";
  ctx.lineWidth = 1.6;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(182, 86);
  ctx.lineTo(184, 66);
  ctx.lineTo(176, 55);
  ctx.stroke();
  ctx.lineCap = "butt";
  ctx.fillStyle = "#f4b829";
  ctx.beginPath();
  ctx.moveTo(172, 50);
  ctx.lineTo(181, 55);
  ctx.lineTo(171, 60);
  ctx.lineTo(166, 54);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#d49c1f";
  ctx.beginPath();
  ctx.moveTo(166, 54);
  ctx.lineTo(171, 60);
  ctx.lineTo(167.5, 60);
  ctx.closePath();
  ctx.fill();
}

// Window light and lamp pool: added on top, so the bench glows and the dark parts stay dark.
function drawLight(ctx: Ctx, sky: Sky) {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const day = 1 - sky.night;
  if (day > 0.05) {
    const { x, y, w, h } = WIN;
    const g = ctx.createLinearGradient(x, y + h, x + 40, BENCH_TOP);
    g.addColorStop(0, rgba(sky.sun, 0.2 * day));
    g.addColorStop(1, rgba(sky.sun, 0.02 * day));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x + 6, y + h + 4);
    ctx.lineTo(x + w - 4, y + h + 4);
    ctx.lineTo(x + w + 44, BENCH_TOP + 1);
    ctx.lineTo(x + 26, BENCH_TOP + 1);
    ctx.closePath();
    ctx.fill();
    glow(ctx, x + w / 2, y + h - 4, 52, mix(sky.sun, sky.bottom, 0.3), 0.14 * day);
  }
  const lamp = smooth(0.08, 0.4, sky.night) * (0.7 + 0.5 * sky.night);
  if (lamp > 0) {
    glow(ctx, 172, 58, 40, hex("#ffbf6a"), 0.34 * lamp);
    glow(ctx, 160, 90, 40, hex("#ffbf6a"), 0.22 * lamp);
    const cone = ctx.createLinearGradient(172, 58, 160, BENCH_TOP + 4);
    cone.addColorStop(0, `rgba(255,214,140,${0.26 * lamp})`);
    cone.addColorStop(1, `rgba(255,214,140,${0.03 * lamp})`);
    ctx.fillStyle = cone;
    ctx.beginPath();
    ctx.moveTo(168, 59);
    ctx.lineTo(176, 59);
    ctx.lineTo(192, BENCH_TOP + 4);
    ctx.lineTo(148, BENCH_TOP + 4);
    ctx.closePath();
    ctx.fill();
    glow(ctx, 171, 56, 5, hex("#fff2c8"), 0.9 * lamp);
  }
  glow(ctx, MON.x + MON.w / 2, MON.y + 22, 60, hex("#6fffb0"), 0.04 + 0.14 * sky.night);
  ctx.restore();
}

const CODE_ROWS = [11, 7, 14, 9, 12, 5, 13, 8, 10, 6];
const CODE_INDENT = [0, 2, 2, 4, 2, 0, 2, 4, 4, 2];
const CODE_COLORS = ["#8af0ae", "#9dbcef", "#f4b829", "#d8f5e2", "#f3a6bb"];

function drawMonitorScreen(ctx: Ctx, sky: Sky, time: number) {
  const { x, y } = MON;
  const power = 0.7 + 0.3 * sky.night;
  const scroll = Math.floor(time * 2);
  for (let r = 0; r < 8; r++) {
    const i = (r + scroll) % CODE_ROWS.length;
    ctx.fillStyle = rgba(hex(CODE_COLORS[i % CODE_COLORS.length]), 0.9 * power);
    ctx.fillRect(x + 4 + CODE_INDENT[i], y + 4 + r * 2.8, CODE_ROWS[i], 1.2);
  }
  if (time % 1 < 0.55) rect(ctx, x + 4 + CODE_INDENT[scroll % CODE_INDENT.length] + 12, y + 4 + 7 * 2.8, 1.4, 1.5, "rgba(255,255,255,0.9)");

  rect(ctx, x + 24.5, y + 4, 0.6, 21, "rgba(138,240,174,0.3)");
  ctx.strokeStyle = rgba(hex("#8af0ae"), power);
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= 15; i++) {
    const px = x + 26.5 + i * 0.8;
    const py = y + 13 + Math.sin(i * 1 + time * 5) * 5 + Math.sin(i * 2.1 + time * 3) * 1.5;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
  rect(ctx, x + 26.5, y + 22, 12, 1.2, `rgba(244,184,41,${0.75 * power})`);
}

function drawLeds(ctx: Ctx, sky: Sky, time: number) {
  const boost = 0.5 + 0.5 * sky.night;
  const blink = time % 1 < 0.5;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  if (blink) glow(ctx, 56.4, 87.6, 10, hex("#ffb23a"), 0.75 * boost);
  glow(ctx, 59.4, 87.6, 5, hex("#58ff9a"), 0.4 * boost);
  glow(ctx, 83.4, 88.6, blink ? 7 : 4.5, hex("#ff4a3a"), (blink ? 0.7 : 0.25) * boost);
  ctx.restore();
  rect(ctx, 55.4, 87, 2, 1.3, blink ? "#ffd27a" : "#5c3a14");
  rect(ctx, 58.8, 87, 1.2, 1.3, "#7dffb0");
  ctx.fillStyle = blink ? "#ff8a7a" : "#8a2a22";
  ctx.beginPath();
  ctx.arc(83.4, 88.4, 1.5, 0, Math.PI * 2);
  ctx.fill();
}

function drawWires(ctx: Ctx) {
  const wires: [string, number, number, number, number, number][] = [
    ["#f4b829", 66, 79.5, 45, 80.5, 9],
    ["#3fbf72", 70, 79.5, 40, 80.5, 13],
    ["#ef6a4c", 66, 92.8, 38, 92.8, -5],
  ];
  ctx.lineWidth = 1.1;
  ctx.lineCap = "round";
  for (const [color, x1, y1, x2, y2, bow] of wires) {
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.quadraticCurveTo((x1 + x2) / 2, Math.min(y1, y2) - bow, x2, y2);
    ctx.stroke();
  }
  ctx.lineCap = "butt";
}

function drawSmoke(ctx: Ctx, time: number) {
  for (let i = 0; i < 9; i++) {
    const p = (time * 0.28 + i / 9) % 1;
    const sx = 107.6 + Math.sin(p * 9 + i * 1.3) * (1.2 + p * 5);
    const sy = 79 - p * 30;
    const size = 1.3 + p * 3.2;
    ctx.fillStyle = `rgba(232,234,242,${((1 - p) * (1 - p) * 0.5).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(sx, sy, size, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawClouds(ctx: Ctx, sky: Sky, time: number) {
  const alpha = (1 - sky.night * 0.85) * 0.85;
  if (alpha <= 0.02) return;
  const { x, y, w, h } = WIN;
  const lit = mix([255, 255, 255], sky.bottom, 0.4 + sky.night * 0.3);
  const shade = mix(lit, sky.mid, 0.45);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  const clouds: [number, number, number, number][] = [[0.1, 20, 1, 1.3], [0.55, 36, 0.7, 0.8], [0.85, 14, 0.8, 1]];
  for (const [phase, cy, scale, speed] of clouds) {
    const cx = x - 20 + ((phase * (w + 40) + time * speed * 1.4) % (w + 40));
    for (const [dx, dy, r, tone] of [[0, 0, 5.5, 0], [6, -2.5, 6.5, 0], [13, 0, 5, 0], [6, 1.5, 6, 1]] as const) {
      ctx.fillStyle = rgba(tone ? shade : lit, alpha);
      ctx.beginPath();
      ctx.ellipse(cx + dx * scale, y + cy + dy * scale, r * scale * 1.3, r * scale * 0.82, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawStars(ctx: Ctx, sky: Sky, time: number) {
  const stars = smooth(0.66, 0.95, sky.t);
  if (stars <= 0) return;
  const { x, y, w } = WIN;
  for (let i = 0; i < 46; i++) {
    const sx = x + 2 + ((i * 37 + 11) % (w - 4));
    const sy = y + 2 + ((i * 53 + 5) % 38);
    const twinkle = 0.5 + 0.5 * Math.sin(time * (1 + (i % 4) * 0.5) + i * 1.7);
    ctx.fillStyle = `rgba(255,255,255,${(stars * (0.3 + 0.6 * twinkle)).toFixed(2)})`;
    const size = i % 7 === 0 ? 1.1 : 0.7;
    ctx.fillRect(sx, sy, size, size);
  }
}

function drawDrone(ctx: Ctx, sky: Sky, time: number) {
  const cx = 47 + Math.sin(time * 0.6) * 5;
  const cy = 34 + Math.sin(time * 1.7) * 2.2;
  const tilt = Math.sin(time * 0.9);
  const ambient = mix([255, 255, 255], sky.ambient, 0.8);
  const shade = (h: string) => rgba(mul(hex(h), ambient));
  const rotors: [number, number][] = [[-11, -3], [11, -3], [-10, 3.5], [10, 3.5]];

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(tilt * 0.06);
  ctx.scale(1.55, 1.55);
  ctx.strokeStyle = shade("#10161a");
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  for (const [dx, dy] of rotors) {
    ctx.moveTo(0, 0);
    ctx.lineTo(dx, dy);
  }
  ctx.stroke();

  ctx.fillStyle = shade("#10161a");
  ctx.beginPath();
  ctx.roundRect(-4.6, -2.5, 9.2, 5.4, 1.2);
  ctx.fill();
  ctx.fillStyle = shade("#ff7a4a");
  ctx.fillRect(-3.2, -1.5, 6.4, 1.7);
  ctx.fillStyle = shade("#9fb4c4");
  ctx.beginPath();
  ctx.arc(0, 2.8, 1.3, 0, Math.PI * 2);
  ctx.fill();

  const spin = time * 70;
  for (const [dx, dy] of rotors) {
    const reach = 5 * Math.abs(Math.cos(spin + dx));
    ctx.fillStyle = shade("#10161a");
    ctx.fillRect(dx - 0.6, dy - 1.8, 1.2, 1.8);
    ctx.fillStyle = "rgba(24,34,46,0.28)";
    ctx.beginPath();
    ctx.ellipse(dx, dy - 1.9, 5.6, 1.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = shade("#10161a");
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(dx - reach, dy - 1.9);
    ctx.lineTo(dx + reach, dy - 1.9);
    ctx.stroke();
  }
  ctx.restore();

  const boost = 0.5 + 0.5 * sky.night;
  const lx = 10 * 1.55;
  const ly = 3.5 * 1.55;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  glow(ctx, cx - lx, cy + ly, 9, hex("#ff3a3a"), 0.65 * boost);
  glow(ctx, cx + lx, cy + ly, 9, hex("#3aff7a"), 0.65 * boost);
  glow(ctx, cx, cy, 26, hex("#ffffff"), 0.1 * sky.night);
  ctx.restore();
  rect(ctx, cx - lx - 1, cy + ly, 2, 2, "#ff8a8a");
  rect(ctx, cx + lx - 1, cy + ly, 2, 2, "#8affb0");

  // a soft contact shadow on the bench keeps it from looking pasted on
  ctx.fillStyle = "rgba(10,16,24,0.14)";
  ctx.beginPath();
  ctx.ellipse(cx, BENCH_TOP + 2.5, 15, 1.6, 0, 0, Math.PI * 2);
  ctx.fill();
}

export type Scene = { draw: (ctx: Ctx, t: number, time: number) => void };

/** Allocates the cached layers once; `draw` repaints the full frame into `ctx` (SCENE_W*2 by SCENE_H*2 pixels). */
export function createScene(): Scene | null {
  const skyLayer = newLayer();
  const landLayer = newLayer();
  const roomLayer = newLayer();
  const lightLayer = newLayer();
  if (!skyLayer.ctx || !landLayer.ctx || !roomLayer.ctx || !lightLayer.ctx) return null;
  let builtFor = -1;
  let sky = skyAt(0);

  const rebuild = (t: number) => {
    sky = skyAt(t);
    for (const layer of [skyLayer, landLayer, roomLayer, lightLayer]) layer.ctx?.clearRect(0, 0, SCENE_W, SCENE_H);
    drawSky(skyLayer.ctx!, sky);
    drawLandscape(landLayer.ctx!, sky);
    drawRoom(roomLayer.ctx!, sky);
    drawLight(lightLayer.ctx!, sky);
    builtFor = t;
  };

  return {
    draw(ctx, t, time) {
      if (Math.abs(t - builtFor) > 0.0005) rebuild(t);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(skyLayer.canvas, 0, 0);
      ctx.restore();
      ctx.save();
      ctx.scale(SCALE, SCALE);
      drawStars(ctx, sky, time);
      drawClouds(ctx, sky, time);
      ctx.restore();
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(landLayer.canvas, 0, 0);
      ctx.drawImage(roomLayer.canvas, 0, 0);
      ctx.globalCompositeOperation = "lighter";
      ctx.drawImage(lightLayer.canvas, 0, 0);
      ctx.restore();
      ctx.save();
      ctx.scale(SCALE, SCALE);
      drawMonitorScreen(ctx, sky, time);
      drawWires(ctx);
      drawLeds(ctx, sky, time);
      drawSmoke(ctx, time);
      drawDrone(ctx, sky, time);
      ctx.restore();
    },
  };
}
