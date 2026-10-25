/** Charts for Ultra Enhanced: lines over time (solid or dashed) and a histogram. */

export interface Line {
  label: string;
  /** CSS custom property holding the colour. */
  color: string;
  values: number[];
  dashed?: boolean;
}

function css(el: Element, name: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim();
}

export function fitCanvas(canvas: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; w: number; h: number } {
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

/** A round axis maximum that splits into four round gridlines. */
export function niceTop(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v / 4));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 10]) if (m * p * 4 >= v) return m * p * 4;
  return 40 * p;
}

function niceCeil(v: number): number {
  const p = 10 ** Math.floor(Math.log10(Math.max(1e-9, v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

export function formatNum(v: number): string {
  return Math.abs(v) >= 1000 ? `${+(v / 1000).toFixed(2)}k` : String(+v.toFixed(2));
}

/** Line chart over iterations with a hover crosshair and tooltip. */
export class TimeChart {
  private hoverX: number | null = null;
  private ticks: number[] = [];
  private lines: Line[] = [];
  /** Shaded vertical bands (e.g. winters), as [fromTick, toTick]. */
  private bands: [number, number][] = [];
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

  draw(ticks: number[], lines: Line[], bands: [number, number][] = []): void {
    this.ticks = ticks;
    this.lines = lines;
    this.bands = bands;
    this.redraw();
  }

  private redraw(): void {
    const { canvas, pad, ticks } = this;
    const { ctx, w, h } = fitCanvas(canvas);
    const n = ticks.length;
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;
    const lines = this.lines.map((l) => ({ ...l, stroke: css(canvas, l.color) }));
    const maxTick = Math.max(10, ticks[n - 1] ?? 0);
    const minTick = ticks[0] ?? 0;
    let maxY = 0;
    for (const l of lines) for (const v of l.values) if (v > maxY && Number.isFinite(v)) maxY = v;
    maxY = niceTop(Math.max(maxY, 1));
    const xOf = (t: number) => pad.left + ((t - minTick) / Math.max(1, maxTick - minTick)) * plotW;
    const yOf = (v: number) => pad.top + plotH - (Math.min(v, maxY * 1.05) / maxY) * plotH;

    ctx.fillStyle = css(canvas, "--band");
    for (const [a, b] of this.bands) {
      const x0 = Math.max(pad.left, xOf(a));
      const x1 = Math.min(pad.left + plotW, xOf(b));
      if (x1 > x0) ctx.fillRect(x0, pad.top, x1 - x0, plotH);
    }

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
    for (let t = Math.ceil(minTick / tStep) * tStep; t <= maxTick; t += tStep) ctx.fillText(String(t), xOf(t), pad.top + plotH + 8);
    if (n === 0) return;

    const stride = Math.max(1, Math.floor(n / plotW));
    ctx.lineJoin = "round";
    for (const l of lines) {
      ctx.strokeStyle = l.stroke;
      ctx.lineWidth = l.dashed ? 1.5 : 2;
      ctx.setLineDash(l.dashed ? [5, 4] : []);
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < n; i += stride) {
        const v = l.values[i];
        if (!Number.isFinite(v)) {
          started = false;
          continue;
        }
        if (!started) ctx.moveTo(xOf(ticks[i]), yOf(v));
        else ctx.lineTo(xOf(ticks[i]), yOf(v));
        started = true;
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);

    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.font = "12px system-ui, sans-serif";
    ctx.fillStyle = css(canvas, "--text-secondary");
    const labels = lines
      .map((l) => ({ text: l.label, y: yOf(lastFinite(l.values)) }))
      .filter((l) => Number.isFinite(l.y))
      .sort((a, b) => a.y - b.y);
    for (let i = 1; i < labels.length; i++) labels[i].y = Math.max(labels[i].y, labels[i - 1].y + 14);
    const xEnd = xOf(ticks[n - 1]) + 6;
    for (const l of labels) ctx.fillText(l.text, xEnd, l.y);

    if (this.hoverX !== null && this.hoverX >= pad.left && this.hoverX <= pad.left + plotW) {
      const t = minTick + ((this.hoverX - pad.left) / plotW) * (maxTick - minTick);
      const i = nearestIndex(ticks, t);
      const x = xOf(ticks[i]);
      ctx.strokeStyle = css(canvas, "--text-muted");
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, pad.top);
      ctx.lineTo(Math.round(x) + 0.5, pad.top + plotH);
      ctx.stroke();
      for (const l of lines) {
        if (!Number.isFinite(l.values[i])) continue;
        ctx.fillStyle = l.stroke;
        ctx.strokeStyle = css(canvas, "--surface");
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, yOf(l.values[i]), 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      this.tooltip.hidden = false;
      this.tooltip.innerHTML =
        `<strong>Iteration ${ticks[i]}</strong>` +
        lines
          .filter((l) => Number.isFinite(l.values[i]))
          .map((l) => `<span><i style="background:var(${l.color})"></i>${l.label} <b>${formatNum(l.values[i])}</b></span>`)
          .join("");
      const tw = this.tooltip.offsetWidth;
      this.tooltip.style.left = `${x + 12 + tw > w ? Math.max(0, x - tw - 12) : x + 12}px`;
      this.tooltip.style.top = `${pad.top}px`;
    } else {
      this.tooltip.hidden = true;
    }
  }
}

function lastFinite(values: number[]): number {
  for (let i = values.length - 1; i >= 0; i--) if (Number.isFinite(values[i])) return values[i];
  return NaN;
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

/** How a trait is spread across one species right now, with the starting value marked. */
export function drawHistogram(canvas: HTMLCanvasElement, values: number[], color: string, start: number, unit: string): void {
  const { ctx, w, h } = fitCanvas(canvas);
  if (!values.length) {
    ctx.font = "12px system-ui, sans-serif";
    ctx.fillStyle = css(canvas, "--text-muted");
    ctx.textAlign = "center";
    ctx.fillText("None alive", w / 2, h / 2);
    return;
  }
  const pad = { left: 36, right: 12, top: 22, bottom: 30 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;
  const bins = 20;
  let lo = Math.min(start, ...values);
  let hi = Math.max(start, ...values);
  if (hi - lo < 1e-6) {
    lo -= 0.5;
    hi += 0.5;
  }
  const counts = new Array<number>(bins).fill(0);
  for (const v of values) counts[Math.min(bins - 1, Math.floor(((v - lo) / (hi - lo)) * bins))]++;
  const maxC = Math.max(1, ...counts);
  const bw = plotW / bins;
  ctx.fillStyle = css(canvas, color);
  for (let b = 0; b < bins; b++) {
    const bh = (counts[b] / maxC) * plotH;
    if (bh <= 0) continue;
    ctx.beginPath();
    ctx.roundRect(pad.left + b * bw + 1, pad.top + plotH - bh, Math.max(1, bw - 2), bh, 2);
    ctx.fill();
  }
  const xs = pad.left + ((start - lo) / (hi - lo)) * plotW;
  ctx.strokeStyle = css(canvas, "--text-secondary");
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(xs, pad.top - 4);
  ctx.lineTo(xs, pad.top + plotH);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.font = "11px system-ui, sans-serif";
  ctx.fillStyle = css(canvas, "--text-muted");
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.fillText(formatNum(lo), pad.left, pad.top + plotH + 6);
  ctx.textAlign = "right";
  ctx.fillText(formatNum(hi), pad.left + plotW, pad.top + plotH + 6);
  ctx.textAlign = "center";
  ctx.fillText(unit, pad.left + plotW / 2, pad.top + plotH + 6);
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = css(canvas, "--text-secondary");
  ctx.font = "12px system-ui, sans-serif";
  ctx.textAlign = Math.abs(xs - pad.left) < 60 ? "left" : "center";
  ctx.fillText(`start ${formatNum(start)}`, xs, 14);
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillStyle = css(canvas, "--text-muted");
  ctx.fillText(String(maxC), pad.left - 6, pad.top);
  ctx.fillText("0", pad.left - 6, pad.top + plotH);
}
