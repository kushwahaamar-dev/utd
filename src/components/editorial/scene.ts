// The workshop of the landing hero, drawn procedurally at 144 x 96 "pixels". GlyphScene samples this canvas into
// glyphs. `t` is the time of day (0 dawn, 1/3 noon, 2/3 dusk, 1 night); `time` is seconds, for the moving parts.

export const SCENE_W = 144;
export const SCENE_H = 88;

type RGB = [number, number, number];

const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a: RGB, b: RGB, k: number): RGB => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const rgba = (c: RGB, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (a: number, b: number, v: number) => {
  const k = clamp01((v - a) / (b - a));
  return k * k * (3 - 2 * k);
};

type Sky = { t: number; top: RGB; bottom: RGB; ambient: RGB; night: number; sun: RGB };

const SKIES: Sky[] = [
  { t: 0, top: hex("#3b3f8f"), bottom: hex("#f7a77c"), ambient: hex("#ecc4b4"), night: 0.25, sun: hex("#ffd9a0") },
  { t: 0.33, top: hex("#4a90e2"), bottom: hex("#bfe3ff"), ambient: hex("#ffffff"), night: 0, sun: hex("#fff6d0") },
  { t: 0.66, top: hex("#5a3d8a"), bottom: hex("#ff8a4c"), ambient: hex("#ffc9a0"), night: 0.4, sun: hex("#ffb060") },
  { t: 1, top: hex("#0b1236"), bottom: hex("#2a3f8a"), ambient: hex("#6e80cd"), night: 1, sun: hex("#ffb060") },
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
    bottom: mix(a.bottom, b.bottom, k),
    ambient: mix(a.ambient, b.ambient, k),
    night: a.night + (b.night - a.night) * k,
    sun: mix(a.sun, b.sun, k),
  };
}

function box(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
}

function glow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: RGB, alpha: number) {
  if (alpha <= 0.01) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(color, alpha));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

const WINDOW = { x: 8, y: 6, w: 54, h: 42 };

function drawSky(ctx: CanvasRenderingContext2D, sky: Sky, time: number) {
  const { x, y, w, h } = WINDOW;
  for (let row = 0; row < h; row++) box(ctx, x, y + row, w, 1, rgba(mix(sky.top, sky.bottom, Math.pow(row / h, 0.85))));

  const stars = smooth(0.62, 0.95, sky.t);
  if (stars > 0) {
    for (let i = 0; i < 40; i++) {
      const sx = x + ((i * 37 + 11) % w);
      const sy = y + ((i * 53 + 5) % 30);
      const tw = 0.5 + 0.5 * Math.sin(time * (1 + (i % 4) * 0.5) + i * 1.7);
      box(ctx, sx, sy, 1, 1, `rgba(255,255,255,${(stars * (0.35 + 0.55 * tw)).toFixed(2)})`);
    }
  }

  const sunP = sky.t / 0.7;
  const sunX = x + 4 + sunP * (w - 8);
  const sunY = y + h - 2 - Math.sin(Math.min(sunP, 1.3) * Math.PI) * 34;
  glow(ctx, sunX, sunY, 16, sky.sun, 0.55 * (1 - smooth(0.7, 0.85, sky.t)));
  ctx.fillStyle = rgba(mix(sky.sun, [255, 255, 255], 0.5), 1 - smooth(0.72, 0.86, sky.t));
  ctx.beginPath();
  ctx.arc(sunX, sunY, 3.4, 0, Math.PI * 2);
  ctx.fill();

  const moon = smooth(0.7, 0.95, sky.t);
  if (moon > 0) {
    const mx = x + 12 + clamp01((sky.t - 0.7) / 0.3) * (w - 24);
    const my = y + 11 - Math.sin(clamp01((sky.t - 0.7) / 0.3) * Math.PI) * 4;
    glow(ctx, mx, my, 12, hex("#9db4ff"), 0.3 * moon);
    ctx.fillStyle = `rgba(240,244,255,${moon})`;
    ctx.beginPath();
    ctx.arc(mx, my, 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = rgba(mix(sky.top, sky.bottom, 0.2), moon);
    ctx.beginPath();
    ctx.arc(mx + 1.6, my - 0.8, 2.8, 0, Math.PI * 2);
    ctx.fill();
  }

  const hill = mix(hex("#2c4a3a"), sky.bottom, 0.25 + sky.night * -0.15);
  ctx.fillStyle = rgba(mix(hill, [8, 12, 24], sky.night * 0.7));
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, y + h - 7);
  ctx.quadraticCurveTo(x + 10, y + h - 12, x + 20, y + h - 6);
  ctx.quadraticCurveTo(x + 32, y + h - 1, x + w, y + h - 9);
  ctx.lineTo(x + w, y + h);
  ctx.fill();
  ctx.fillStyle = rgba(mix([22, 44, 34], [6, 10, 20], sky.night * 0.8));
  ctx.fillRect(x + 31, y + h - 12, 1, 5);
  ctx.fillRect(x + 30, y + h - 11, 3, 1);
  ctx.fillRect(x + 30, y + h - 9, 3, 1);
  ctx.fillRect(x + 29, y + h - 8, 5, 1);
}

function drawRoom(ctx: CanvasRenderingContext2D) {
  box(ctx, 0, 0, SCENE_W, 72, "#4a5f7a");
  for (let gy = 4; gy < 70; gy += 4) for (let gx = 2; gx < SCENE_W; gx += 4) box(ctx, gx, gy, 1, 1, "#3b4c66");
  box(ctx, 0, 62, SCENE_W, 8, "#42557a");

  const { x, y, w, h } = WINDOW;
  box(ctx, x - 2, y - 2, w + 4, h + 4, "#c98a4e");
  box(ctx, x - 2, y + h, w + 4, 3, "#e0a366");
  box(ctx, x + 26, y, 1, h, "#c98a4e");

  box(ctx, 62, 23, 36, 2, "#c98a4e");
  const parts = ["#ef6a4c", "#76a0e2", "#f4b829", "#93d3b0", "#f3a6bb"];
  [64, 71, 78, 85, 91].forEach((bx, i) => box(ctx, bx, 15 + (i % 2), 6, 8 - (i % 2), parts[i]));
  box(ctx, 66, 18, 2, 1, "#231e16");
  box(ctx, 80, 19, 2, 1, "#231e16");

  box(ctx, 104, 8, 34, 26, "#a38a5c");
  for (let gy = 10; gy < 34; gy += 3) for (let gx = 106; gx < 138; gx += 3) box(ctx, gx, gy, 1, 1, "#5e4c30");
  box(ctx, 108, 11, 2, 12, "#c6ccce");
  box(ctx, 107, 9, 4, 3, "#c6ccce");
  box(ctx, 108, 9, 2, 1, "#6a777c");
  box(ctx, 116, 12, 2, 10, "#ef6a4c");
  box(ctx, 115, 22, 4, 5, "#ef6a4c");
  box(ctx, 124, 10, 7, 4, "#8f989b");
  box(ctx, 127, 14, 2, 14, "#8a5a34");
  box(ctx, 132, 12, 2, 12, "#f4b829");
  box(ctx, 131, 24, 4, 2, "#f4b829");

  box(ctx, 0, 68, SCENE_W, 3, "#d79a58");
  box(ctx, 0, 71, SCENE_W, 1, "#7a4d28");
  box(ctx, 0, 72, SCENE_W, 16, "#33414f");
  for (let dx = 4; dx < SCENE_W; dx += 36) {
    box(ctx, dx, 75, 32, 11, "#415062");
    box(ctx, dx + 12, 79, 8, 2, "#c6ccce");
  }
}

function drawBench(ctx: CanvasRenderingContext2D) {
  box(ctx, 8, 58, 36, 10, "#0e8296");
  box(ctx, 8, 58, 36, 1, "#16a3b8");
  box(ctx, 10, 59, 22, 1, "#101820");
  box(ctx, 14, 66, 28, 1, "#101820");
  for (let i = 0; i < 14; i++) {
    if (i % 2 === 0) box(ctx, 11 + i * 2, 59, 1, 1, "#d8b45a");
    box(ctx, 15 + i * 2, 66, 1, 1, "#d8b45a");
  }
  box(ctx, 5, 60, 7, 6, "#c6ccce");
  box(ctx, 6, 61, 5, 4, "#8f989b");
  box(ctx, 28, 61, 9, 4, "#101820");
  box(ctx, 29, 62, 7, 2, "#2a3238");
  box(ctx, 21, 62, 2, 1, "#101820");
  box(ctx, 40, 60, 3, 3, "#c6ccce");

  box(ctx, 48, 61, 20, 7, "#e8e4d8");
  box(ctx, 48, 64, 20, 1, "#bdb8a8");
  for (let gx = 50; gx < 67; gx += 2) {
    box(ctx, gx, 62, 1, 1, "#9a958a");
    box(ctx, gx, 66, 1, 1, "#9a958a");
  }
  box(ctx, 54, 61, 2, 3, "#d8b45a");
  box(ctx, 57, 61, 4, 1, "#b2692f");
  box(ctx, 58, 60, 1, 1, "#c6ccce");
  box(ctx, 62, 60, 2, 2, "#ef6a4c");
  box(ctx, 62, 58, 1, 2, "#c6ccce");

  box(ctx, 72, 36, 36, 25, "#1f262b");
  box(ctx, 88, 61, 4, 5, "#2a3238");
  box(ctx, 82, 66, 16, 2, "#2a3238");

  box(ctx, 110, 62, 14, 6, "#2a3238");
  box(ctx, 112, 60, 8, 2, "#8f989b");
  box(ctx, 113, 64, 10, 1, "#394248");
  box(ctx, 118, 66, 20, 1, "#d8cfa8");

  box(ctx, 126, 66, 10, 2, "#2a3238");
  box(ctx, 130, 52, 1, 14, "#8f989b");
  ctx.strokeStyle = "#8f989b";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(130.5, 52);
  ctx.lineTo(126.5, 44);
  ctx.stroke();
  box(ctx, 121, 41, 8, 4, "#f4b829");
  box(ctx, 120, 42, 2, 2, "#d49c1f");
}

function tint(ctx: CanvasRenderingContext2D, sky: Sky) {
  const { x, y, w, h } = WINDOW;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, SCENE_W, SCENE_H);
  ctx.rect(x, y, w, h);
  ctx.clip("evenodd");
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = rgba(sky.ambient);
  ctx.fillRect(0, 0, SCENE_W, SCENE_H);
  ctx.restore();
}

const CODE_ROWS = [7, 12, 5, 9, 14, 6, 11, 4, 13, 8, 10, 6];
const CODE_COLORS = ["#8af0ae", "#9dbcef", "#f4b829", "#d8f5e2", "#f3a6bb"];

function drawMonitor(ctx: CanvasRenderingContext2D, sky: Sky, time: number) {
  const power = 0.55 + 0.45 * sky.night;
  glow(ctx, 90, 48, 34, hex("#6fffb0"), 0.16 * sky.night);
  box(ctx, 74, 38, 32, 21, "#07130e");
  const scroll = Math.floor(time * 2.5);
  for (let r = 0; r < 8; r++) {
    const len = CODE_ROWS[(r + scroll) % CODE_ROWS.length];
    const color = hex(CODE_COLORS[(r + scroll) % CODE_COLORS.length]);
    box(ctx, 76 + (r % 3 === 1 ? 2 : 0), 40 + r * 2, len, 1, rgba(color, 0.8 * power));
  }
  box(ctx, 91, 40, 1, 17, `rgba(138,240,174,${0.25 * power})`);
  ctx.strokeStyle = rgba(hex("#8af0ae"), power);
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= 12; i++) {
    const px = 93 + i;
    const py = 48 + Math.sin(i * 0.9 + time * 5) * 4 + Math.sin(i * 2.3 + time * 3) * 1.4;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
  box(ctx, 92, 56, 12, 1, `rgba(244,184,41,${0.7 * power})`);
}

function drawLamp(ctx: CanvasRenderingContext2D, sky: Sky) {
  const on = smooth(0.1, 0.35, sky.night);
  if (on <= 0) return;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  glow(ctx, 121, 44, 20, hex("#ffcf80"), 0.5 * on);
  const g = ctx.createLinearGradient(121, 44, 104, 70);
  g.addColorStop(0, `rgba(255,214,140,${0.32 * on})`);
  g.addColorStop(1, `rgba(255,214,140,${0.04 * on})`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(121, 45);
  ctx.lineTo(125, 45);
  ctx.lineTo(138, 70);
  ctx.lineTo(82, 70);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawLight(ctx: CanvasRenderingContext2D, sky: Sky) {
  const day = 1 - sky.night;
  if (day <= 0.05) return;
  const { x, y, w, h } = WINDOW;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const g = ctx.createLinearGradient(x, y + h, x + 30, 70);
  g.addColorStop(0, rgba(sky.sun, 0.1 * day));
  g.addColorStop(1, rgba(sky.sun, 0.01 * day));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(x, y + h + 1);
  ctx.lineTo(x + w, y + h + 1);
  ctx.lineTo(x + w + 34, 69);
  ctx.lineTo(x + 20, 69);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawLeds(ctx: CanvasRenderingContext2D, sky: Sky, time: number) {
  const boost = 0.45 + 0.55 * sky.night;
  const blink = time % 1 < 0.5;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  if (blink) glow(ctx, 30.5, 63, 7, hex("#ffb23a"), 0.6 * boost);
  glow(ctx, 25.5, 63, 4, hex("#58ff9a"), 0.35 * boost);
  glow(ctx, 63, 60.5, 5, hex("#ff4a3a"), 0.45 * boost);
  glow(ctx, 112, 64, 7, hex("#ff7a2a"), 0.4 * boost);
  ctx.restore();
  box(ctx, 30, 62, 2, 1, blink ? "#ffd27a" : "#5c3a14");
  box(ctx, 25, 62, 1, 1, "#7dffb0");
  box(ctx, 63, 60, 1, 1, "#ff9a8a");
  box(ctx, 112, 63, 2, 1, "#ff9a4a");
}

function drawSmoke(ctx: CanvasRenderingContext2D, time: number) {
  for (let i = 0; i < 4; i++) {
    const p = (time * 0.35 + i / 4) % 1;
    const sx = 113 + Math.sin(p * 8 + i * 2.1) * (1.5 + p * 4);
    const sy = 60 - p * 28;
    ctx.fillStyle = `rgba(228,230,236,${((1 - p) * 0.55).toFixed(2)})`;
    const size = 1 + Math.round(p * 2);
    ctx.fillRect(Math.round(sx), Math.round(sy), size, size);
  }
}

function drawDrone(ctx: CanvasRenderingContext2D, sky: Sky, time: number) {
  const cx = 35 + Math.sin(time * 0.6) * 3.5;
  const cy = 24 + Math.sin(time * 1.7) * 1.8;
  const tilt = Math.sin(time * 0.9) * 0.9;
  const ambient = mix([255, 255, 255], sky.ambient, 0.8);
  const shade = (h: string) => {
    const c = hex(h);
    return rgba([(c[0] * ambient[0]) / 255, (c[1] * ambient[1]) / 255, (c[2] * ambient[2]) / 255]);
  };
  const rotors = [[-11, -3], [11, -3], [-10, 3], [10, 3]];

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(tilt * 0.05);
  ctx.scale(1.9, 1.9);
  ctx.strokeStyle = shade("#10161a");
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  for (const [dx, dy] of rotors) {
    ctx.moveTo(0, 0);
    ctx.lineTo(dx, dy);
  }
  ctx.stroke();

  ctx.fillStyle = shade("#10161a");
  ctx.fillRect(-4.5, -2.4, 9, 5.2);
  ctx.fillStyle = shade("#ff7a4a");
  ctx.fillRect(-3, -1.4, 6, 1.6);
  ctx.fillStyle = shade("#9fb4c4");
  ctx.fillRect(-1.2, 1.4, 2.4, 1.6);

  const spin = time * 60;
  for (const [dx, dy] of rotors) {
    const reach = 4.8 * Math.abs(Math.cos(spin + dx));
    ctx.fillStyle = shade("#10161a");
    ctx.fillRect(dx - 0.6, dy - 1.8, 1.2, 1.8);
    ctx.fillStyle = "rgba(20,30,40,0.3)";
    ctx.beginPath();
    ctx.ellipse(dx, dy - 1.9, 5.4, 1.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = shade("#10161a");
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(dx - reach, dy - 1.9);
    ctx.lineTo(dx + reach, dy - 1.9);
    ctx.stroke();
  }
  ctx.restore();

  const boost = 0.55 + 0.45 * sky.night;
  const lx = 10 * 1.9;
  const ly = 3 * 1.9;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  glow(ctx, cx - lx, cy + ly, 9, hex("#ff3a3a"), 0.6 * boost);
  glow(ctx, cx + lx, cy + ly, 9, hex("#3aff7a"), 0.6 * boost);
  glow(ctx, cx, cy, 22, hex("#ffffff"), 0.12 * sky.night);
  ctx.restore();
  box(ctx, cx - lx - 1, cy + ly, 2, 2, "#ff8a8a");
  box(ctx, cx + lx - 1, cy + ly, 2, 2, "#8affb0");
}

export function drawScene(ctx: CanvasRenderingContext2D, t: number, time: number) {
  const sky = skyAt(t);
  ctx.imageSmoothingEnabled = true;
  drawRoom(ctx);
  drawSky(ctx, sky, time);
  drawBench(ctx);
  tint(ctx, sky);
  drawLight(ctx, sky);
  drawLamp(ctx, sky);
  drawMonitor(ctx, sky, time);
  drawLeds(ctx, sky, time);
  drawSmoke(ctx, time);
  drawDrone(ctx, sky, time);
}
