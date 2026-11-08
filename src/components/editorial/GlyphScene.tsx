"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cx } from "@/components/ui/cx";
import { SCENE_H, SCENE_W, drawScene } from "./scene";

export type GlyphSceneLabels = {
  /** The canvas's text alternative. */
  scene: string;
  /** The slider's name. */
  time: string;
  dawn: string;
  noon: string;
  dusk: string;
  night: string;
};

const RAMP = " .:-=+*#%@";
const FRAME_MS = 1000 / 30;
const PHASES = ["dawn", "noon", "dusk", "night"] as const;
const PHASE_AT = [0, 1 / 3, 2 / 3, 1];
const STATIC_TIME = 1.3;

function hash(n: number) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function wantsReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.reduceMotion === "true";
}

type Grid = {
  cols: number;
  rows: number;
  dpr: number;
  atlas: HTMLCanvasElement;
  cellW: number;
  cellH: number;
  keep: Float32Array;
};

function buildAtlas(cellW: number, cellH: number, dpr: number, family: string) {
  const w = Math.ceil(cellW * dpr);
  const h = Math.ceil(cellH * dpr);
  const atlas = document.createElement("canvas");
  atlas.width = w * RAMP.length;
  atlas.height = h;
  const ctx = atlas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#fff";
    ctx.font = `700 ${Math.round(h * 0.92)}px ${family}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let i = 1; i < RAMP.length; i++) ctx.fillText(RAMP[i], i * w + w / 2, h / 2 + h * 0.04);
  }
  return atlas;
}

function buildGrid(width: number, height: number, dpr: number, family: string): Grid {
  const target = width < 520 ? 5 : 6;
  const cols = Math.max(24, Math.round(width / target));
  const rows = Math.max(16, Math.round(height / (target * 1.6)));
  const cellW = width / cols;
  const cellH = height / rows;
  const keep = new Float32Array(cols * rows);
  const bandX = 0.07;
  const bandY = 0.1;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const dx = Math.min(x + 0.5, cols - x - 0.5) / cols / bandX;
      const dy = Math.min(y + 0.5, rows - y - 0.5) / rows / bandY;
      const edge = Math.min(1, dx, dy);
      const fall = edge * edge * (3 - 2 * edge);
      keep[y * cols + x] = hash(y * cols + x) < fall ? 1 : 0;
    }
  }
  return { cols, rows, dpr, atlas: buildAtlas(cellW, cellH, dpr, family), cellW, cellH, keep };
}

function phaseOf(t: number) {
  let best = 0;
  PHASE_AT.forEach((at, i) => {
    if (Math.abs(at - t) < Math.abs(PHASE_AT[best] - t)) best = i;
  });
  return PHASES[best];
}

/**
 * The landing's hero: a procedurally drawn workshop, sampled into coloured glyphs chosen by luminance. The slider
 * moves the time of day. It draws at 30 fps, only while on screen and visible, and once for reduced motion.
 */
export function GlyphScene({ labels, className, initial = 0.62 }: { labels: GlyphSceneLabels; className?: string; initial?: number }) {
  const [time, setTime] = useState(initial);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const target = useRef(initial);
  const redraw = useRef<() => void>(() => {});

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!wrap || !canvas || !ctx) return;

    const scene = document.createElement("canvas");
    scene.width = SCENE_W;
    scene.height = SCENE_H;
    const sceneCtx = scene.getContext("2d");
    const sample = document.createElement("canvas");
    const sampleCtx = sample.getContext("2d", { willReadFrequently: true });
    if (!sceneCtx || !sampleCtx) return;

    let grid: Grid | null = null;
    let current = target.current;
    let clock = 0;
    let last = 0;
    let raf = 0;
    let onScreen = false;
    let visible = !document.hidden;
    let reduced = wantsReducedMotion();
    let family = "monospace";
    let paperLum = 1;
    let disposed = false;

    // Glyph weight follows how far a pixel is from the page: ink on light paper, light on dark.
    const readPaper = () => {
      const [r, g, b] = (getComputedStyle(document.body).backgroundColor.match(/[\d.]+/g) ?? [250, 250, 250]).map(Number);
      paperLum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    };

    const resize = () => {
      const width = wrap.clientWidth;
      const height = wrap.clientHeight;
      if (width < 10 || height < 10) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      grid = buildGrid(width, height, dpr, family);
      sample.width = grid.cols;
      sample.height = grid.rows;
      paint();
    };

    const paint = () => {
      if (!grid) return;
      const { cols, rows, dpr, atlas, cellW, cellH, keep } = grid;
      drawScene(sceneCtx, current, reduced ? STATIC_TIME : clock);
      sampleCtx.imageSmoothingEnabled = true;
      sampleCtx.imageSmoothingQuality = "high";
      sampleCtx.drawImage(scene, 0, 0, cols, rows);
      const { data } = sampleCtx.getImageData(0, 0, cols, rows);

      const gw = Math.ceil(cellW * dpr);
      const gh = Math.ceil(cellH * dpr);
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const cell = y * cols + x;
          if (keep[cell] === 0) continue;
          const o = cell * 4;
          const lum = (0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2]) / 255;
          const weight = Math.min(1, Math.abs(lum - paperLum) / 0.8);
          const glyph = Math.round(Math.pow(weight, 0.8) * (RAMP.length - 1));
          if (glyph === 0) continue;
          ctx.drawImage(atlas, glyph * gw, 0, gw, gh, Math.round(x * cellW * dpr), Math.round(y * cellH * dpr), gw, gh);
        }
      }
      ctx.globalCompositeOperation = "source-in";
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(sample, 0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = "destination-over";
      ctx.imageSmoothingEnabled = true;
      ctx.globalAlpha = 0.12;
      ctx.drawImage(sample, 0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    };

    const step = (now: number) => {
      raf = 0;
      if (disposed || reduced || !onScreen || !visible) return;
      raf = requestAnimationFrame(step);
      if (now - last < FRAME_MS) return;
      clock += Math.min(now - last, 100) / 1000;
      last = now;
      const gap = target.current - current;
      current = Math.abs(gap) < 0.002 ? target.current : current + gap * 0.16;
      paint();
    };

    const sync = () => {
      if (raf || reduced || !onScreen || !visible) return;
      last = performance.now();
      raf = requestAnimationFrame(step);
    };

    redraw.current = () => {
      if (reduced) {
        current = target.current;
        paint();
      }
    };

    const io = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting;
      sync();
    });
    io.observe(wrap);
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    const onVisibility = () => {
      visible = !document.hidden;
      sync();
    };
    document.addEventListener("visibilitychange", onVisibility);
    readPaper();
    const retheme = () => {
      readPaper();
      if (!raf) paint();
    };
    const themeWatch = new MutationObserver(retheme);
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const scheme = window.matchMedia("(prefers-color-scheme: dark)");
    scheme.addEventListener("change", retheme);
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMotion = () => {
      reduced = wantsReducedMotion();
      if (reduced) paint();
      else sync();
    };
    motion.addEventListener("change", onMotion);

    const mono = getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim();
    if (mono) family = `${mono}, monospace`;
    document.fonts.load(`500 12px ${family}`).then(() => {
      if (disposed) return;
      resize();
    });
    resize();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      motion.removeEventListener("change", onMotion);
      scheme.removeEventListener("change", retheme);
      themeWatch.disconnect();
    };
  }, []);

  const setTarget = useCallback((value: number) => {
    target.current = value;
    setTime(value);
    redraw.current();
  }, []);

  const phase = phaseOf(time);

  return (
    <figure className={cx("m-0", className)}>
      <div
        ref={wrapRef}
        role="img"
        aria-label={labels.scene}
        className="relative aspect-[144/88] w-full overflow-hidden rounded-[28px]"
        style={{
          maskImage: "linear-gradient(to right, transparent, #000 6%, #000 94%, transparent), linear-gradient(to bottom, transparent, #000 8%, #000 92%, transparent)",
          maskComposite: "intersect",
          WebkitMaskImage: "linear-gradient(to right, transparent, #000 6%, #000 94%, transparent), linear-gradient(to bottom, transparent, #000 8%, #000 92%, transparent)",
          WebkitMaskComposite: "source-in",
        }}
      >
        <canvas ref={canvasRef} aria-hidden="true" className="absolute inset-0 size-full [filter:saturate(1.45)_contrast(1.12)]" />
      </div>
      <div className="mx-auto mt-3 w-[min(22rem,80%)]">
        <input
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={time}
          onChange={(event) => setTarget(Number(event.target.value))}
          aria-label={labels.time}
          aria-valuetext={labels[phase]}
          className="time-slider"
        />
        <div aria-hidden="true" className="mt-1 flex justify-between font-ui text-[11px] leading-4 tracking-[0.06em] text-muted/80">
          {PHASES.map((name) => (
            <span key={name} className={cx("transition-colors", name === phase && "text-ink")}>
              {labels[name]}
            </span>
          ))}
        </div>
      </div>
    </figure>
  );
}
