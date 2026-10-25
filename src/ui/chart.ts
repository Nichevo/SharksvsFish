/** Canvas charts: lines over time (with hover crosshair + tooltip), age pyramids and a phase plot. */
import { FEMALE, FISH, MALE, SHARK, type Individual } from "../engine/types";

/** One entry per recorded iteration. */
export interface History {
  ticks: number[];
  fish: number[];
  sharks: number[];
  fishBorn: number[];
  sharksBorn: number[];
  fishEaten: number[];
  fishOldAge: number[];
  fishStarved: number[];
  sharksOldAge: number[];
  sharksStarved: number[];
  /** All causes. */
  fishDied: number[];
  sharksDied: number[];
  /** Cells with algae (0 when algae is off). */
  algae: number[];
  algaeEaten: number[];
}

export type SeriesKey = Exclude<keyof History, "ticks">;

export function emptyHistory(): History {
  return {
    ticks: [],
    fish: [],
    sharks: [],
    fishBorn: [],
    sharksBorn: [],
    fishEaten: [],
    fishOldAge: [],
    fishStarved: [],
    sharksOldAge: [],
    sharksStarved: [],
    fishDied: [],
    sharksDied: [],
    algae: [],
    algaeEaten: [],
  };
}

export interface SeriesDef {
  key: SeriesKey;
  label: string;
  /** CSS custom property holding the colour. */
  color: string;
}

function css(el: Element, name: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim();
}

function fitCanvas(canvas: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; w: number; h: number } {
  const ctx = canvas.getContext("2d")!;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

/** Trailing moving average. */
function smooth(values: number[], window: number): number[] {
  if (window <= 1) return values;
  const out = new Array<number>(values.length);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= window) sum -= values[i - window];
    out[i] = sum / Math.min(i + 1, window);
  }
  return out;
}

export class LineChart {
  private hoverX: number | null = null;
  private history: History = emptyHistory();
  private series: SeriesDef[] = [];
  private window = 1;
  private pad = { left: 44, right: 88, top: 12, bottom: 26 };

  constructor(
    private canvas: HTMLCanvasElement,
    private tooltip: HTMLElement,
  ) {
    canvas.addEventListener("pointermove", (e) => {
      this.hoverX = e.offsetX;
      this.redraw();
    });
    canvas.addEventListener("pointerleave", () => {
      this.hoverX = null;
      this.tooltip.hidden = true;
      this.redraw();
    });
  }

  /** `smoothing` is the moving-average window in iterations (1 = raw values). */
  draw(history: History, series: SeriesDef[], smoothing = 1): void {
    this.history = history;
    this.series = series;
    this.window = smoothing;
    this.redraw();
  }

  private redraw(): void {
    const { canvas, pad, history } = this;
    const { ctx, w, h } = fitCanvas(canvas);
    const n = history.ticks.length;
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;
    const lines = this.series.map((s) => ({ ...s, values: smooth(history[s.key], this.window), stroke: css(canvas, s.color) }));
    const maxTick = Math.max(10, history.ticks[n - 1] ?? 0);
    const minTick = history.ticks[0] ?? 0;
    let maxY = 0;
    for (const l of lines) for (const v of l.values) if (v > maxY) maxY = v;
    maxY = niceTop(Math.max(maxY, 4));
    const xOf = (t: number) => pad.left + ((t - minTick) / Math.max(1, maxTick - minTick)) * plotW;
    const yOf = (v: number) => pad.top + plotH - (v / maxY) * plotH;

    // Grid and axes
    ctx.font = "11px system-ui, sans-serif";
    ctx.fillStyle = css(canvas, "--text-muted");
    ctx.strokeStyle = css(canvas, "--grid");
    ctx.lineWidth = 1;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let i = 0; i <= 4; i++) {
      const v = (maxY / 4) * i;
      const y = Math.round(yOf(v)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(pad.left + plotW, y);
      ctx.stroke();
      ctx.fillText(formatNum(v), pad.left - 6, y);
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const tStep = niceCeil((maxTick - minTick) / 5);
    for (let t = Math.ceil(minTick / tStep) * tStep; t <= maxTick; t += tStep) {
      ctx.fillText(String(t), xOf(t), pad.top + plotH + 8);
    }

    if (n === 0) return;

    // Lines (thinned to about one point per pixel for long runs)
    const stride = Math.max(1, Math.floor(n / plotW));
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    for (const l of lines) {
      ctx.strokeStyle = l.stroke;
      ctx.beginPath();
      for (let i = 0; i < n; i += stride) {
        const x = xOf(history.ticks[i]);
        const y = yOf(l.values[i]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.lineTo(xOf(history.ticks[n - 1]), yOf(l.values[n - 1]));
      ctx.stroke();
    }

    // Direct labels at the line ends, pushed apart if they collide
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.font = "12px system-ui, sans-serif";
    ctx.fillStyle = css(canvas, "--text-secondary");
    const labels = lines.map((l) => ({ text: l.label, y: yOf(l.values[n - 1]) })).sort((a, b) => a.y - b.y);
    for (let i = 1; i < labels.length; i++) labels[i].y = Math.max(labels[i].y, labels[i - 1].y + 14);
    const xEnd = xOf(history.ticks[n - 1]) + 6;
    for (const l of labels) ctx.fillText(l.text, xEnd, l.y);

    // Hover crosshair + tooltip
    if (this.hoverX !== null && this.hoverX >= pad.left && this.hoverX <= pad.left + plotW) {
      const t = minTick + ((this.hoverX - pad.left) / plotW) * (maxTick - minTick);
      const i = nearestIndex(history.ticks, t);
      const x = xOf(history.ticks[i]);
      ctx.strokeStyle = css(canvas, "--text-muted");
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, pad.top);
      ctx.lineTo(Math.round(x) + 0.5, pad.top + plotH);
      ctx.stroke();
      for (const l of lines) {
        ctx.fillStyle = l.stroke;
        ctx.strokeStyle = css(canvas, "--surface");
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, yOf(l.values[i]), 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
      this.tooltip.hidden = false;
      this.tooltip.innerHTML =
        `<strong>Iteration ${history.ticks[i]}</strong>` +
        lines.map((l) => `<span><i style="background:var(${l.color})"></i>${l.label} <b>${fmt(l.values[i])}</b></span>`).join("") +
        (this.window > 1 ? `<em>${this.window}-iteration average</em>` : "");
      const tw = this.tooltip.offsetWidth;
      this.tooltip.style.left = `${x + 12 + tw > w ? Math.max(0, x - tw - 12) : x + 12}px`;
      this.tooltip.style.top = `${pad.top}px`;
    } else {
      this.tooltip.hidden = true;
    }
  }
}

/**
 * Age pyramid for one species: age bands up the side, males to the left and females
 * to the right. Without sexes, one bar per band.
 */
export function drawPyramid(
  canvas: HTMLCanvasElement,
  individuals: Individual[],
  family: typeof FISH | typeof SHARK,
  ageLimit: number,
  sexes: boolean,
): void {
  const { ctx, w, h } = fitCanvas(canvas);
  const pad = { left: 52, right: 12, top: 22, bottom: 20 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;

  // Round band widths (1, 2, 5, 10, 20...) giving at most 10 bands up to the age limit.
  let size = 1;
  while (Math.ceil((ageLimit + 1) / size) > 10) {
    const p = 10 ** Math.floor(Math.log10(size));
    size = size / p === 1 ? 2 * p : size / p === 2 ? 5 * p : 10 * p;
  }
  const bands = Math.max(1, Math.ceil((ageLimit + 1) / size));
  const male = new Array<number>(bands).fill(0);
  const female = new Array<number>(bands).fill(0);
  const all = new Array<number>(bands).fill(0);
  for (const c of individuals) {
    if (c.family !== family) continue;
    const b = Math.min(bands - 1, Math.floor(c.age / size));
    all[b]++;
    if (c.sex === MALE) male[b]++;
    else if (c.sex === FEMALE) female[b]++;
  }
  const maxV = Math.max(1, ...(sexes ? [...male, ...female] : all));
  const color = css(canvas, family === FISH ? "--fish" : "--shark");
  const rowH = plotH / bands;
  const barH = Math.max(2, rowH - 2);
  const mid = pad.left + plotW / 2;
  const half = plotW / 2 - 2;

  ctx.font = "11px system-ui, sans-serif";
  ctx.textBaseline = "middle";
  for (let b = 0; b < bands; b++) {
    // Youngest at the bottom, as in a population pyramid
    const y = pad.top + plotH - (b + 1) * rowH + 1;
    ctx.fillStyle = css(canvas, "--text-muted");
    ctx.textAlign = "right";
    ctx.fillText(`${b * size}–${(b + 1) * size - 1}`, pad.left - 6, y + barH / 2);
    ctx.fillStyle = color;
    if (sexes) {
      const lw = (male[b] / maxV) * half;
      const rw = (female[b] / maxV) * half;
      const sp = family === FISH ? "--fish" : "--shark";
      ctx.fillStyle = css(canvas, `${sp}-male`);
      roundRect(ctx, mid - 1 - lw, y, lw, barH);
      ctx.fillStyle = css(canvas, `${sp}-female`);
      roundRect(ctx, mid + 1, y, rw, barH);
    } else {
      roundRect(ctx, pad.left, y, (all[b] / maxV) * plotW, barH);
    }
  }

  ctx.fillStyle = css(canvas, "--text-secondary");
  ctx.textBaseline = "alphabetic";
  ctx.font = "12px system-ui, sans-serif";
  if (sexes) {
    const m = male.reduce((a, v) => a + v, 0);
    const f = female.reduce((a, v) => a + v, 0);
    ctx.textAlign = "left";
    ctx.fillText(`Male ${m}`, pad.left, 14);
    ctx.textAlign = "right";
    ctx.fillText(`Female ${f}`, w - pad.right, 14);
  } else {
    ctx.textAlign = "left";
    ctx.fillText(`By age (${all.reduce((a, v) => a + v, 0)} alive)`, pad.left, 14);
  }
  ctx.textAlign = "center";
  ctx.fillStyle = css(canvas, "--text-muted");
  ctx.font = "11px system-ui, sans-serif";
  ctx.fillText(`Bar length: number in each age band (max ${maxV})`, pad.left + plotW / 2, h - 4);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  if (w <= 0) return;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(3, w / 2));
  ctx.fill();
}

/** Fish against sharks: a stable cycle shows up as a loop, a crash as a line to an axis. */
export function drawPhase(canvas: HTMLCanvasElement, history: History): void {
  const { ctx, w, h } = fitCanvas(canvas);
  const pad = { left: 48, right: 16, top: 12, bottom: 34 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;
  const n = history.ticks.length;
  let maxX = 4;
  let maxY = 4;
  for (let i = 0; i < n; i++) {
    if (history.fish[i] > maxX) maxX = history.fish[i];
    if (history.sharks[i] > maxY) maxY = history.sharks[i];
  }
  maxX = niceTop(maxX);
  maxY = niceTop(maxY);
  const xOf = (v: number) => pad.left + (v / maxX) * plotW;
  const yOf = (v: number) => pad.top + plotH - (v / maxY) * plotH;

  ctx.font = "11px system-ui, sans-serif";
  ctx.strokeStyle = css(canvas, "--grid");
  ctx.fillStyle = css(canvas, "--text-muted");
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = Math.round(yOf((maxY / 4) * i)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + plotW, y);
    ctx.stroke();
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(formatNum((maxY / 4) * i), pad.left - 6, y);
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(formatNum((maxX / 4) * i), xOf((maxX / 4) * i), pad.top + plotH + 6);
  }
  ctx.fillStyle = css(canvas, "--text-secondary");
  ctx.textAlign = "center";
  ctx.fillText("Fish", pad.left + plotW / 2, h - 14);
  ctx.save();
  ctx.translate(12, pad.top + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textBaseline = "middle";
  ctx.fillText("Sharks", 0, 0);
  ctx.restore();
  if (n === 0) return;

  // Older parts of the path fade so the current direction is clear.
  const color = css(canvas, "--text-secondary");
  const stride = Math.max(1, Math.floor(n / 1500));
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = "round";
  const segments = 20;
  const per = Math.ceil(n / segments);
  for (let s = 0; s < segments; s++) {
    const from = s * per;
    const to = Math.min(n - 1, (s + 1) * per);
    if (from >= to) break;
    ctx.globalAlpha = 0.15 + 0.85 * ((s + 1) / segments);
    ctx.beginPath();
    for (let i = from; i <= to; i += stride) {
      const x = xOf(history.fish[i]);
      const y = yOf(history.sharks[i]);
      if (i === from) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.lineTo(xOf(history.fish[to]), yOf(history.sharks[to]));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // Current position
  ctx.fillStyle = css(canvas, "--accent");
  ctx.strokeStyle = css(canvas, "--surface");
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(xOf(history.fish[n - 1]), yOf(history.sharks[n - 1]), 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

function nearestIndex(sorted: number[], t: number): number {
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(sorted[lo - 1] - t) < Math.abs(sorted[lo] - t)) lo--;
  return lo;
}

/** A round axis maximum that splits into four round gridlines. */
function niceTop(v: number): number {
  const p = 10 ** Math.floor(Math.log10(v / 4));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 10]) if (m * p * 4 >= v) return m * p * 4;
  return 40 * p;
}

function niceCeil(v: number): number {
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

function formatNum(v: number): string {
  return v >= 1000 ? `${+(v / 1000).toFixed(2)}k` : String(+v.toFixed(1));
}
