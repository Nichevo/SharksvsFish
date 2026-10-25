/** The batch experiments card: pick two settings, run seeds in web workers, draw the survival grid. */
import type { UltraSettings } from "../engine/ultra";
import { getPath, type Field } from "../ui/fields";
import { steps, type BatchJob, type BatchResult } from "./batch";
import BatchWorker from "./batch.worker?worker&inline";
import { drawHeatmap, formatNum, type HeatCell } from "./chart";
import { ULTRA_FIELDS } from "./fields";

type Base = Omit<UltraSettings, "seed">;
type NumField = Extract<Field, { kind: "number" | "percent" }> & { group: string };

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

/** Every number setting can be an axis. */
const AXES: NumField[] = ULTRA_FIELDS.flatMap((g) =>
  g.fields.filter((f): f is Extract<Field, { kind: "number" | "percent" }> => f.kind === "number" || f.kind === "percent").map((f) => ({ ...f, group: g.title })),
);

const fieldFor = (path: string) => AXES.find((f) => f.path === path)!;
/** Percent settings are typed in as 0-100 but stored as 0-1. */
const scale = (f: NumField) => (f.kind === "percent" ? 100 : 1);
const axisName = (f: NumField) => `${f.group}: ${f.label}${f.kind === "percent" ? " (%)" : ""}`;

interface Grid {
  x: NumField;
  y: NumField;
  xs: number[];
  ys: number[];
  cells: (HeatCell & { ticks: number })[];
}

export function initBatch(getBase: () => Base, onPick: (values: Record<string, number>) => void): void {
  const canvas = $<HTMLCanvasElement>("#batch");
  const tooltip = $("#b-tooltip");
  const runBtn = $<HTMLButtonElement>("#b-run");
  const progress = $("#b-progress");
  let grid: Grid | null = null;
  let workers: Worker[] = [];
  let hover: { x: number; y: number } | null = null;
  let hoveredCell: number | null = null;

  for (const [axis, path, from, to] of [
    ["bx", "species.sharks.start", 20, 140],
    ["by", "species.fish.breedChance", 20, 80],
  ] as const) {
    const select = $<HTMLSelectElement>(`#${axis}-path`);
    for (const f of AXES) select.add(new Option(axisName(f), f.path, false, f.path === path));
    $<HTMLInputElement>(`#${axis}-from`).value = String(from);
    $<HTMLInputElement>(`#${axis}-to`).value = String(to);
    // A new setting starts from its current value, halved and doubled.
    select.addEventListener("change", () => {
      const f = fieldFor(select.value);
      const v = (getPath(getBase() as unknown as Record<string, unknown>, f.path) as number) * scale(f);
      const max = f.kind === "percent" ? 100 : f.max;
      $<HTMLInputElement>(`#${axis}-from`).value = String(+Math.max(f.kind === "percent" ? 0 : f.min, v / 2).toFixed(2));
      $<HTMLInputElement>(`#${axis}-to`).value = String(+Math.min(max, v * 2 || 1).toFixed(2));
    });
  }

  const num = (id: string, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(+$<HTMLInputElement>(id).value) || lo));

  function axisValues(axis: "bx" | "by"): { field: NumField; values: number[] } {
    const field = fieldFor($<HTMLSelectElement>(`#${axis}-path`).value);
    const n = num(`#${axis}-steps`, 1, 20);
    const s = scale(field);
    let values = steps(+$<HTMLInputElement>(`#${axis}-from`).value / s, +$<HTMLInputElement>(`#${axis}-to`).value / s, n);
    // Whole-number settings get whole numbers (and no repeats).
    if (field.kind === "number" && (field.step ?? 1) >= 1) values = [...new Set(values.map(Math.round))];
    return { field, values };
  }

  function stop(): void {
    for (const w of workers) w.terminate();
    workers = [];
    runBtn.textContent = "Run batch";
  }

  function start(): void {
    const base = getBase();
    const { field: x, values: xs } = axisValues("bx");
    const { field: y, values: ys } = axisValues("by");
    const seeds = num("#b-seeds", 1, 500);
    const maxTicks = num("#b-ticks", 10, 100000);
    grid = { x, y, xs, ys, cells: xs.flatMap(() => ys.map(() => ({ runs: 0, survived: 0, ticks: 0 }))) };
    const jobs: BatchJob[] = [];
    // Seeds go round the grid so the picture fills in evenly.
    for (let s = 0; s < seeds; s++) {
      ys.forEach((yv, yi) =>
        xs.forEach((xv, xi) => jobs.push({ cell: yi * xs.length + xi, seed: 1000 + s, values: { [x.path]: xv, [y.path]: yv } })),
      );
    }
    const total = jobs.length;
    let done = 0;
    const started = performance.now();
    const threads = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));
    runBtn.textContent = "Stop";
    const busy = new Set<Worker>();
    const finish = () => {
      const secs = (performance.now() - started) / 1000;
      progress.textContent = `${total} runs in ${secs.toFixed(1)}s`;
      stop();
    };
    // Hand out a few jobs at a time so fast workers pick up the slack.
    const next = (w: Worker) => {
      const chunk = jobs.splice(0, 4);
      if (chunk.length) return w.postMessage({ base, maxTicks, jobs: chunk });
      busy.delete(w);
      if (!busy.size) finish();
    };
    for (let t = 0; t < threads; t++) {
      const w = new BatchWorker();
      w.onmessage = (e: MessageEvent<BatchResult | "done">) => {
        if (e.data === "done") return next(w);
        const r = e.data;
        const c = grid!.cells[r.cell];
        c.runs++;
        c.ticks += r.ticks;
        if (r.survived) c.survived++;
        done++;
        progress.textContent = `${done} of ${total} runs`;
        draw();
      };
      workers.push(w);
      busy.add(w);
      next(w);
    }
  }

  function draw(): void {
    if (!grid) {
      drawHeatmap(canvas, [], [], [], { x: "", y: "" }, null);
      return;
    }
    const g = grid;
    const fmt = (f: NumField, v: number) => (f.kind === "percent" ? `${Math.round(v * 100)}%` : formatNum(v));
    hoveredCell = drawHeatmap(
      canvas,
      g.xs.map((v) => fmt(g.x, v)),
      g.ys.map((v) => fmt(g.y, v)),
      g.cells,
      { x: axisName(g.x), y: axisName(g.y) },
      hover,
    );
    const c = hoveredCell === null ? null : g.cells[hoveredCell];
    if (c && hover && c.runs) {
      const xi = hoveredCell! % g.xs.length;
      const yi = Math.floor(hoveredCell! / g.xs.length);
      tooltip.hidden = false;
      tooltip.innerHTML =
        `<strong>${g.x.group} ${g.x.label.toLowerCase()} ${fmt(g.x, g.xs[xi])}</strong>` +
        `<strong>${g.y.group} ${g.y.label.toLowerCase()} ${fmt(g.y, g.ys[yi])}</strong>` +
        `<span>Every species survived <b>${c.survived} of ${c.runs}</b></span>` +
        `<span>Average length <b>${Math.round(c.ticks / c.runs)} iterations</b></span>` +
        `<em>Click to load these settings</em>`;
      const tw = tooltip.offsetWidth;
      tooltip.style.left = `${hover.x + 12 + tw > canvas.clientWidth ? Math.max(0, hover.x - tw - 12) : hover.x + 12}px`;
      tooltip.style.top = `${Math.max(0, hover.y - 20)}px`;
    } else tooltip.hidden = true;
  }

  runBtn.addEventListener("click", () => (workers.length ? (stop(), (progress.textContent += " (stopped)")) : start()));
  canvas.addEventListener("pointermove", (e) => {
    hover = { x: e.offsetX, y: e.offsetY };
    draw();
  });
  canvas.addEventListener("pointerleave", () => {
    hover = null;
    draw();
  });
  canvas.addEventListener("click", () => {
    if (!grid || hoveredCell === null) return;
    const xi = hoveredCell % grid.xs.length;
    const yi = Math.floor(hoveredCell / grid.xs.length);
    onPick({ [grid.x.path]: grid.xs[xi], [grid.y.path]: grid.ys[yi] });
  });
  window.addEventListener("resize", draw);
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", draw);
  draw();
}
