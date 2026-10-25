/** Population-over-time line chart on a canvas, with a hover crosshair and tooltip. */
export interface History {
  ticks: number[];
  fish: number[];
  sharks: number[];
}

export class PopulationChart {
  private ctx: CanvasRenderingContext2D;
  private hoverX: number | null = null;
  private history: History = { ticks: [], fish: [], sharks: [] };
  private pad = { left: 44, right: 64, top: 12, bottom: 26 };

  constructor(
    private canvas: HTMLCanvasElement,
    private tooltip: HTMLElement,
  ) {
    this.ctx = canvas.getContext("2d")!;
    canvas.addEventListener("pointermove", (e) => {
      this.hoverX = e.offsetX;
      this.draw(this.history);
    });
    canvas.addEventListener("pointerleave", () => {
      this.hoverX = null;
      this.tooltip.hidden = true;
      this.draw(this.history);
    });
  }

  private css(name: string): string {
    return getComputedStyle(this.canvas).getPropertyValue(name).trim();
  }

  draw(history: History): void {
    this.history = history;
    const { canvas, ctx, pad } = this;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const n = history.ticks.length;
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;
    const maxTick = Math.max(10, history.ticks[n - 1] ?? 0);
    const minTick = history.ticks[0] ?? 0;
    let maxY = 10;
    for (let i = 0; i < n; i++) maxY = Math.max(maxY, history.fish[i], history.sharks[i]);
    maxY = niceCeil(maxY);
    const xOf = (t: number) => pad.left + ((t - minTick) / Math.max(1, maxTick - minTick)) * plotW;
    const yOf = (v: number) => pad.top + plotH - (v / maxY) * plotH;

    // Grid and axes
    ctx.font = "11px system-ui, sans-serif";
    ctx.fillStyle = this.css("--text-muted");
    ctx.strokeStyle = this.css("--grid");
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
    const series: [number[], string, string][] = [
      [history.fish, this.css("--fish"), "Fish"],
      [history.sharks, this.css("--shark"), "Sharks"],
    ];
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    for (const [values, color] of series) {
      ctx.strokeStyle = color;
      ctx.beginPath();
      for (let i = 0; i < n; i += stride) {
        const x = xOf(history.ticks[i]);
        const y = yOf(values[i]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.lineTo(xOf(history.ticks[n - 1]), yOf(values[n - 1]));
      ctx.stroke();
    }

    // Direct labels at the line ends, nudged apart if they collide
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.font = "12px system-ui, sans-serif";
    let yFish = yOf(history.fish[n - 1]);
    let ySharks = yOf(history.sharks[n - 1]);
    if (Math.abs(yFish - ySharks) < 14) {
      const mid = (yFish + ySharks) / 2;
      const up = yFish <= ySharks;
      yFish = mid + (up ? -7 : 7);
      ySharks = mid + (up ? 7 : -7);
    }
    const xEnd = xOf(history.ticks[n - 1]) + 6;
    ctx.fillStyle = this.css("--text-secondary");
    ctx.fillText("Fish", xEnd, yFish);
    ctx.fillText("Sharks", xEnd, ySharks);

    // Hover crosshair + tooltip
    if (this.hoverX !== null && this.hoverX >= pad.left && this.hoverX <= pad.left + plotW) {
      const t = minTick + ((this.hoverX - pad.left) / plotW) * (maxTick - minTick);
      const i = nearestIndex(history.ticks, t);
      const x = xOf(history.ticks[i]);
      ctx.strokeStyle = this.css("--text-muted");
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, pad.top);
      ctx.lineTo(Math.round(x) + 0.5, pad.top + plotH);
      ctx.stroke();
      for (const [values, color] of series) {
        ctx.fillStyle = color;
        ctx.strokeStyle = this.css("--surface");
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, yOf(values[i]), 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      this.tooltip.hidden = false;
      this.tooltip.innerHTML =
        `<strong>Iteration ${history.ticks[i]}</strong>` +
        `<span><i style="background:var(--fish)"></i>Fish <b>${history.fish[i]}</b></span>` +
        `<span><i style="background:var(--shark)"></i>Sharks <b>${history.sharks[i]}</b></span>`;
      const left = Math.min(x + 12, w - this.tooltip.offsetWidth - 4);
      this.tooltip.style.left = `${left < x && x - this.tooltip.offsetWidth - 12 > 0 ? x - this.tooltip.offsetWidth - 12 : left}px`;
      this.tooltip.style.top = `${pad.top}px`;
    } else {
      this.tooltip.hidden = true;
    }
  }
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

function niceCeil(v: number): number {
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

function formatNum(v: number): string {
  return v >= 1000 ? `${+(v / 1000).toFixed(1)}k` : String(Math.round(v));
}
