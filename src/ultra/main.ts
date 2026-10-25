import "../style.css";
import "./ultra.css";
import { randomSeed } from "../engine/rng";
import {
  PAINT_ALGAE,
  PAINT_FEMALE,
  PAINT_SICK,
  PAINT_SPECIES,
  SPECIES,
  SPECIES_LABEL,
  activeSpecies,
  TRAITS,
  UltraSimulation,
  type DeathCause,
  type SpeciesKey,
  type Trait,
} from "../engine/ultra";
import { getPath, setPath, type Field, type FieldGroup } from "../ui/fields";
import { TimeChart, drawHistogram, drawPhase, formatNum, type Line } from "./chart";
import { equilibrium, fitLotkaVolterra, solveLotkaVolterra } from "./lv";
import { initBatch } from "./batch-ui";
import { ULTRA_FIELDS, ULTRA_PRESETS, type UltraPreset } from "./fields";

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

const COLOR: Record<SpeciesKey, string> = { fish: "--fish", barracuda: "--barracuda", sharks: "--shark", orcas: "--orca" };
/** Each species has its own shape so they don't rely on colour alone. */
const SHAPE: Record<SpeciesKey, "square" | "triangle" | "diamond" | "circle"> = {
  fish: "square",
  barracuda: "triangle",
  sharks: "diamond",
  orcas: "circle",
};

function keyIcon(k: SpeciesKey, sex?: "male" | "female"): string {
  return `<i class="key key-${SHAPE[k]}" style="background:var(${COLOR[k]}${sex ? `-${sex}` : ""})"></i>`;
}
const TRAIT_INFO: Record<Trait, { label: string; unit: string; note: string }> = {
  speed: { label: "Speed", unit: "moves per iteration", note: "Faster fish escape and faster sharks catch more, but speed burns energy." },
  sight: { label: "Sight", unit: "cells", note: "Seeing further helps hunt and flee, but costs a little energy." },
  lifespan: { label: "Lifespan", unit: "iterations", note: "Living longer gives more chances to breed, but long-lived creatures have fewer babies each time." },
};
const CAUSES: DeathCause[] = ["eaten", "oldAge", "starved", "disease", "caught"];

const state = {
  settings: structuredClone(ULTRA_PRESETS.evolving.settings) as UltraPreset,
  preset: "evolving",
  seed: randomSeed(),
  running: false,
  speed: 15,
};

type ChartTab = "population" | "traits" | "deaths" | "algae" | "maths";
let chartTab: ChartTab = "population";
let trait: Trait = "speed";
let view: "species" | Trait = "species";

let sim: UltraSimulation;
/** Species switched on in the current pond. */
let live: SpeciesKey[] = [];
let cells: Uint8Array;
let traitCells: Float32Array;
let history: Record<string, number[]>;
const totals: Record<string, number> = {};
const chart = new TimeChart($("#chart"), $("#tooltip"));
const pond = $<HTMLCanvasElement>("#pond");
const pondCtx = pond.getContext("2d")!;

// ---------- settings form ----------

function renderForm(container: HTMLElement, groups: FieldGroup[], target: Record<string, unknown>): void {
  container.replaceChildren();
  for (const group of groups) {
    const fs = document.createElement("fieldset");
    fs.innerHTML = `<legend>${group.title}</legend>`;
    for (const field of group.fields) fs.append(renderField(field, target));
    container.append(fs);
  }
}

function renderField(field: Field, target: Record<string, unknown>): HTMLElement {
  const wrap = document.createElement("label");
  wrap.className = `field field-${field.kind}`;
  const value = getPath(target, field.path);
  let input: HTMLInputElement | HTMLSelectElement;
  if (field.kind === "select") {
    input = document.createElement("select");
    for (const [v, text] of field.options) input.add(new Option(text, v, false, v === value));
    input.addEventListener("change", () => setPath(target, field.path, input.value));
  } else {
    input = document.createElement("input");
    const el = input;
    if (field.kind === "bool") {
      el.type = "checkbox";
      el.checked = Boolean(value);
      el.addEventListener("change", () => setPath(target, field.path, el.checked));
    } else if (field.kind === "percent") {
      el.type = "number";
      el.min = "0";
      el.max = "100";
      el.value = String(Math.round((value as number) * 100));
      el.addEventListener("change", () => setPath(target, field.path, clamp(+el.value, 0, 100) / 100));
    } else {
      const step = field.step ?? 1;
      el.type = "number";
      el.min = String(field.min);
      el.max = String(field.max);
      el.step = String(step);
      el.value = String(value);
      el.addEventListener("change", () => {
        const v = clamp(Math.round(+el.value / step) * step, field.min, field.max);
        el.value = String(+v.toFixed(3));
        setPath(target, field.path, +v.toFixed(3));
      });
    }
  }
  input.id = `f-${field.path.replace(/\./g, "-")}`;
  const label = document.createElement("span");
  label.className = "field-label";
  label.textContent = field.kind === "percent" ? `${field.label} (%)` : field.label;
  if (field.kind === "bool") wrap.append(input, label);
  else wrap.append(label, input);
  if (field.help) {
    const help = document.createElement("small");
    help.textContent = field.help;
    wrap.append(help);
  }
  input.addEventListener("change", () => ($("#apply-hint").hidden = false));
  return wrap;
}

function clamp(v: number, lo: number, hi: number): number {
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo;
}

// ---------- simulation lifecycle ----------

function newPond(): void {
  sim = new UltraSimulation({ ...structuredClone(state.settings), seed: state.seed });
  live = activeSpecies(sim.settings);
  const target = $<HTMLSelectElement>("#ev-disease-target");
  const picked = target.value;
  target.replaceChildren(...live.map((k) => new Option(SPECIES_LABEL[k], k, false, k === picked)));
  $("#hist-box").replaceChildren();
  // Prey and predator pairs for the Lotka-Volterra comparison.
  const pairs: [SpeciesKey, SpeciesKey][] = [["fish", "sharks"], ["fish", "barracuda"], ["sharks", "orcas"]];
  const pairSelect = $<HTMLSelectElement>("#lv-pair");
  const pickedPair = pairSelect.value;
  pairSelect.replaceChildren(
    ...pairs
      .filter(([a, b]) => live.includes(a) && live.includes(b))
      .map(([a, b]) => new Option(`${SPECIES_LABEL[a]} and ${SPECIES_LABEL[b].toLowerCase()}`, `${a},${b}`, false, `${a},${b}` === pickedPair)),
  );
  cells = new Uint8Array(sim.width * sim.height);
  traitCells = new Float32Array(sim.width * sim.height);
  history = { ticks: [], algae: [], growth: [] };
  for (const k of live) {
    for (const s of ["", "Died", ...TRAITS, "Gen"]) history[k + s] = [];
    for (const c of ["born", ...CAUSES, "peak"]) totals[`${k}.${c}`] = 0;
  }
  record();
  $("#apply-hint").hidden = true;
  setRunning(false);
  drawAll();
}

function record(): void {
  const n = sim.counts();
  const stats = sim.traitStats();
  const e = sim.tick === 0 ? null : sim.lastEvents();
  history.ticks.push(sim.tick);
  history.algae.push(sim.algaeCells() ?? 0);
  history.growth.push(sim.growthFactor());
  for (const k of live) {
    history[k].push(n[k]);
    for (const t of TRAITS) history[k + t].push(stats[k].count ? stats[k][t] : NaN);
    history[k + "Gen"].push(stats[k].generation);
    const ev = e?.[k];
    history[k + "Died"].push(ev ? CAUSES.reduce((a, c) => a + ev[c], 0) : 0);
    if (ev) {
      totals[`${k}.born`] += ev.born;
      for (const c of CAUSES) totals[`${k}.${c}`] += ev[c];
    }
    totals[`${k}.peak`] = Math.max(totals[`${k}.peak`], n[k]);
  }
}

function stepOnce(): boolean {
  if (sim.finished()) return false;
  sim.step();
  record();
  return !sim.finished();
}

let lastFrame = 0;
let owed = 0;
function setRunning(on: boolean): void {
  state.running = on && !sim.finished();
  $<HTMLButtonElement>("#run").setAttribute("aria-pressed", String(state.running));
  setRunLabel();
  if (state.running) {
    lastFrame = performance.now();
    owed = 0;
    requestAnimationFrame(loop);
  }
}

function setRunLabel(): void {
  const btn = $<HTMLButtonElement>("#run");
  btn.textContent = state.running ? "Pause" : sim.tick > 0 && !sim.finished() ? "Continue" : "Run";
  btn.disabled = sim.finished();
  for (const id of ["#ev-disease", "#ev-disease-target", "#ev-boat", "#ev-heat"]) $<HTMLButtonElement>(id).disabled = sim.finished();
}

function loop(now: number): void {
  if (!state.running) return;
  owed += state.speed >= 61 ? 50 : ((now - lastFrame) / 1000) * state.speed;
  lastFrame = now;
  const start = performance.now();
  while (owed >= 1) {
    owed--;
    if (!stepOnce()) {
      setRunning(false);
      break;
    }
    if (performance.now() - start > 14) {
      owed = 0;
      break;
    }
  }
  drawAll();
  if (state.running) requestAnimationFrame(loop);
}

// ---------- drawing ----------

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.trim().replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

/** Diverging colour for a trait change: t from -1 (much lower than at the start) to 1 (much higher). */
function divergingColor(css: CSSStyleDeclaration, t: number): string {
  const mid = hexToRgb(css.getPropertyValue("--trait-mid"));
  const end = hexToRgb(css.getPropertyValue(t < 0 ? "--trait-low" : "--trait-high"));
  const a = Math.min(1, Math.abs(t));
  return `rgb(${mid.map((m, i) => Math.round(m + (end[i] - m) * a)).join(",")})`;
}

function drawPond(): void {
  const dpr = window.devicePixelRatio || 1;
  const box = pond.parentElement!.getBoundingClientRect();
  const cell = Math.max(2, Math.floor(Math.min(box.width / sim.width, 560 / sim.height)));
  const w = cell * sim.width;
  const h = cell * sim.height;
  if (pond.width !== w * dpr || pond.height !== h * dpr) {
    pond.width = w * dpr;
    pond.height = h * dpr;
    pond.style.width = `${w}px`;
    pond.style.height = `${h}px`;
  }
  const css = getComputedStyle(pond);
  // With sexes on, males are the darker shade and females the lighter one.
  const sexes = sim.settings.sexes;
  const speciesColor = SPECIES.map((k) => css.getPropertyValue(sexes ? `${COLOR[k]}-male` : COLOR[k]));
  const femaleColor = SPECIES.map((k) => css.getPropertyValue(`${COLOR[k]}-female`));
  const sick = css.getPropertyValue("--sick");
  pondCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  pondCtx.fillStyle = css.getPropertyValue(sim.heatwaveLeft() > 0 ? "--water-hot" : "--water");
  pondCtx.fillRect(0, 0, w, h);
  sim.paint(cells);
  if (view !== "species") sim.paintTrait(traitCells, view);
  const range = view === "sight" ? 2 : 0.5;
  const algae = css.getPropertyValue("--algae");
  const gap = cell >= 6 ? 1 : 0;
  for (let i = 0; i < cells.length; i++) {
    const v = cells[i];
    if (!v) continue;
    const x = (i % sim.width) * cell;
    const y = Math.floor(i / sim.width) * cell;
    if (v === PAINT_ALGAE) {
      // Colouring by trait hides the algae so the creatures stand out.
      if (view !== "species") continue;
      pondCtx.fillStyle = algae;
      pondCtx.fillRect(x + gap, y + gap, cell - gap * 2, cell - gap * 2);
      continue;
    }
    const sp = (v & ~(PAINT_SICK | PAINT_FEMALE)) - PAINT_SPECIES;
    if (view !== "species") pondCtx.fillStyle = divergingColor(css, traitCells[i] / range);
    else pondCtx.fillStyle = v & PAINT_SICK ? sick : v & PAINT_FEMALE ? femaleColor[sp] : speciesColor[sp];
    drawShape(SHAPE[SPECIES[sp]], x, y, cell, gap);
  }
  // Fishing nets sweep across the ocean.
  pondCtx.fillStyle = css.getPropertyValue("--net");
  for (const bx of sim.boats()) {
    const x0 = Math.max(0, bx) * cell;
    const x1 = Math.min(sim.width, bx + sim.settings.events.boats.width) * cell;
    if (x1 > x0) pondCtx.fillRect(x0, 0, x1 - x0, h);
  }
  drawPondKey();
}

function drawShape(shape: (typeof SHAPE)[SpeciesKey], x: number, y: number, cell: number, gap: number): void {
  const c = pondCtx;
  if (shape === "square" || cell < 6) {
    c.fillRect(x + gap, y + gap, cell - gap * 2, cell - gap * 2);
    return;
  }
  c.beginPath();
  if (shape === "diamond") {
    c.moveTo(x + cell / 2, y + gap);
    c.lineTo(x + cell - gap, y + cell / 2);
    c.lineTo(x + cell / 2, y + cell - gap);
    c.lineTo(x + gap, y + cell / 2);
  } else if (shape === "triangle") {
    c.moveTo(x + cell / 2, y + gap);
    c.lineTo(x + cell - gap, y + cell - gap);
    c.lineTo(x + gap, y + cell - gap);
  } else {
    c.arc(x + cell / 2, y + cell / 2, cell / 2 - gap, 0, Math.PI * 2);
  }
  c.fill();
}

function drawPondKey(): void {
  const key = $("#pond-key");
  if (view === "species") {
    key.innerHTML =
      (sim.settings.sexes
        ? live.map((k) => `<span>${keyIcon(k, "male")}${keyIcon(k, "female")}${SPECIES_LABEL[k]}</span>`).join("") +
          `<span class="muted">dark male, light female</span>`
        : live.map((k) => `<span>${keyIcon(k)}${SPECIES_LABEL[k]}</span>`).join("")) +
      `<span><i class="key" style="background:var(--sick)"></i>Sick</span>` +
      (sim.settings.algae.enabled ? `<span><i class="key" style="background:var(--algae)"></i>Algae</span>` : "") +
      `<span><i class="key" style="background:var(--net)"></i>Fishing net</span>`;
  } else {
    const unit = view === "sight" ? "2 cells" : "50%";
    key.innerHTML = `<span>Lower than at the start</span><i class="gradient"></i><span>Higher (full colour = ${unit} or more)</span>`;
  }
}

function drawStats(): void {
  const n = sim.counts();
  const females = sim.femaleCounts();
  $("#stat-tick").textContent = String(sim.tick);
  $("#species-stats").innerHTML = live.map(
    (k) =>
      `<div class="stat"><span class="stat-label">${keyIcon(k)}${SPECIES_LABEL[k]}</span><span class="stat-value">${n[k]}</span>` +
      (sim.settings.sexes ? `<span class="stat-sexes">${n[k] - females[k]} male, ${females[k]} female</span>` : "") +
      `</div>`,
  ).join("");
  $("#stat-gen").textContent = (history.fishGen.at(-1) ?? 0).toFixed(0);

  const season = sim.season();
  const badge = $("#season");
  const heat = sim.heatwaveLeft();
  badge.hidden = !season && !heat;
  const parts: string[] = [];
  if (season) parts.push(`${season[0].toUpperCase()}${season.slice(1)}`);
  if (heat) parts.push(`heatwave, ${heat} left`);
  if (sim.settings.algae.enabled) parts.push(`algae growth ${Math.round(sim.growthFactor() * 100)}%`);
  badge.textContent = parts.join(" · ");
  badge.dataset.season = heat ? "heat" : (season ?? "");

  let status = "";
  if (sim.finished()) {
    const dead = live.filter((k) => n[k] === 0).map((k) => SPECIES_LABEL[k].toLowerCase());
    status = dead.length === live.length ? "Everything died out." : dead.length ? `The ${dead.join(" and ")} died out.` : "Reached the iteration limit.";
  } else if (sim.sickCount()) status = `${sim.sickCount()} sick.`;
  $("#status").textContent = status;
}

/** Winters as shaded bands on the time charts. */
function winterBands(): [number, number][] {
  const s = sim.settings.seasons;
  if (!s.enabled) return [];
  const len = Math.max(4, s.yearLength);
  const out: [number, number][] = [];
  for (let y = 0; y * len <= sim.tick; y++) out.push([y * len + 0.75 * len, (y + 1) * len]);
  return out;
}

function smooth(values: number[], window: number): number[] {
  const out = new Array<number>(values.length);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= window) sum -= values[i - window];
    out[i] = sum / Math.min(i + 1, window);
  }
  return out;
}

function drawCharts(): void {
  let title = "";
  let note = "";
  let lines: Line[] = [];
  const t = history.ticks;
  $("#trait-pick").hidden = chartTab !== "traits";
  $("#hist-box").hidden = chartTab !== "traits";
  $("#lv-box").hidden = chartTab !== "maths";
  $("#lv-pair").hidden = chartTab !== "maths";
  const winters = sim.settings.seasons.enabled ? " Shaded bands are winters." : "";
  if (chartTab === "population") {
    title = "Population over time";
    note = winters.trim();
    lines = live.map((k) => ({ label: SPECIES_LABEL[k], color: COLOR[k], values: history[k] }));
  } else if (chartTab === "traits") {
    const info = TRAIT_INFO[trait];
    title = `Average ${info.label.toLowerCase()} (${info.unit})`;
    note = sim.settings.evolution.enabled ? info.note : "Evolution is off, so traits stay where they started.";
    lines = live.map((k) => ({ label: SPECIES_LABEL[k], color: COLOR[k], values: history[k + trait] }));
    drawHists();
  } else if (chartTab === "deaths") {
    title = "Deaths per iteration";
    note = "All causes, as a 10-iteration average. The totals table below splits them by cause.";
    lines = live.map((k) => ({ label: SPECIES_LABEL[k], color: COLOR[k], values: smooth(history[k + "Died"], 10) }));
  } else if (chartTab === "maths") {
    ({ title, note, lines } = drawMaths());
  } else {
    title = "Algae and fish";
    note = sim.settings.algae.enabled
      ? `Algae patches against fish. The dashed line is algae growth (100% = normal, scaled to the chart).${winters}`
      : "The algae food chain is off, so fish don't need to eat.";
    const top = Math.max(1, ...history.algae, ...history.fish);
    lines = [
      { label: "Algae", color: "--algae-line", values: history.algae },
      { label: "Fish", color: COLOR.fish, values: history.fish },
    ];
    if (sim.settings.algae.enabled && sim.settings.seasons.enabled) {
      lines.push({ label: "Growth", color: "--text-muted", values: history.growth.map((g) => (g / 2) * top), dashed: true });
    }
  }
  chart.draw(t, lines, chartTab === "population" || chartTab === "algae" ? winterBands() : []);
  $("#chart-title").textContent = title;
  $("#chart-note").textContent = note;
  $("#legend-items").innerHTML = lines
    .map((l) => `<span><i class="key ${l.dashed ? "key-dashed" : ""}" style="${l.dashed ? "border-color" : "background"}:var(${l.color})"></i>${l.label}</span>`)
    .join("");
}

/** The run against the Lotka-Volterra equations fitted to it. */
function drawMaths(): { title: string; note: string; lines: Line[] } {
  const [prey, pred] = $<HTMLSelectElement>("#lv-pair").value.split(",") as SpeciesKey[];
  const label = { prey: SPECIES_LABEL[prey], pred: SPECIES_LABEL[pred] };
  const lines: Line[] = [
    { label: label.prey, color: COLOR[prey], values: history[prey] },
    { label: label.pred, color: COLOR[pred], values: history[pred] },
  ];
  const fit = fitLotkaVolterra(history[prey], history[pred]);
  const params = $("#lv-params");
  let model: { prey: number[]; pred: number[] } | null = null;
  let note: string;
  if (fit) {
    const n = history.ticks.length;
    model = solveLotkaVolterra(fit, history[prey][fit.from], history[pred][fit.from], n - fit.from);
    const pad = new Array<number>(fit.from).fill(NaN);
    lines.push(
      { label: `${label.prey} (maths)`, color: COLOR[prey], values: pad.concat(model.prey), dashed: true },
      { label: `${label.pred} (maths)`, color: COLOR[pred], values: pad.concat(model.pred), dashed: true },
    );
    const eq = equilibrium(fit);
    const num = (v: number) => (v < 0.01 ? v.toExponential(2) : formatNum(v));
    params.innerHTML = [
      ["α prey growth", num(fit.alpha)],
      ["β eaten per meeting", num(fit.beta)],
      ["δ predator gain per meeting", num(fit.delta)],
      ["γ predator death rate", num(fit.gamma)],
      [`Balance point`, `${Math.round(eq.prey)} ${label.prey.toLowerCase()}, ${Math.round(eq.pred)} ${label.pred.toLowerCase()}`],
      ["One cycle", `about ${Math.round(eq.period)} iterations`],
      ["Fit (R²)", `${fit.r2Prey.toFixed(2)} prey, ${fit.r2Pred.toFixed(2)} predators`],
    ]
      .map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`)
      .join("");
    note = `Solid lines are your run; dashed lines are the equations, started from the run's numbers at iteration ${history.ticks[fit.from]}. The maths assumes everyone meets everyone, so the real ocean drifts out of step: space, ages, seasons and chance all push it around.`;
  } else {
    params.innerHTML = "";
    note = `Nothing to fit yet. Let both ${label.prey.toLowerCase()} and ${label.pred.toLowerCase()} run for at least 100 iterations through a rise and fall.`;
  }
  const centre = fit ? equilibrium(fit) : null;
  drawPhase($("#lv-phase"), { prey: history[prey], pred: history[pred] }, model, label, centre);
  return { title: "Your run against the Lotka-Volterra equations", note, lines };
}

function drawHists(): void {
  const box = $("#hist-box");
  if (box.childElementCount !== live.length) {
    box.innerHTML = live.map((k) => `<figure><figcaption>${SPECIES_LABEL[k]} right now</figcaption><canvas data-hist="${k}"></canvas></figure>`).join("");
  }
  for (const k of live) {
    const start = { speed: sim.settings.species[k].speed, sight: sim.settings.species[k].sight, lifespan: sim.settings.species[k].maxAge }[trait];
    drawHistogram(box.querySelector(`[data-hist="${k}"]`)!, sim.traitValues(k, trait), COLOR[k], start, TRAIT_INFO[trait].unit);
  }
}

function drawTotals(): void {
  const n = sim.counts();
  const cell = (v: number) => `<td>${v.toLocaleString()}</td>`;
  $("#totals-body").innerHTML = live.map(
    (k) =>
      `<tr><th>${keyIcon(k)}${SPECIES_LABEL[k]}</th>` +
      cell(totals[`${k}.born`]) +
      CAUSES.map((c) => cell(totals[`${k}.${c}`])).join("") +
      cell(n[k]) +
      cell(totals[`${k}.peak`]) +
      "</tr>",
  ).join("");
  const log = sim.eventLog();
  const list = $("#event-log");
  if (list.childElementCount !== log.length || !log.length) {
    list.innerHTML = log.length
      ? log
          .slice(-20)
          .reverse()
          .map((e) => `<li><span class="ev-tick">${e.tick}</span>${e.detail}</li>`)
          .join("")
      : `<li class="muted">None yet. Use the buttons above the ocean.</li>`;
  }
}

function drawAll(): void {
  drawPond();
  drawStats();
  drawCharts();
  drawTotals();
  if (!state.running) setRunLabel();
}

function downloadCsv(): void {
  const cols = Object.keys(history);
  const rows = [cols.join(",")];
  for (let i = 0; i < history.ticks.length; i++) rows.push(cols.map((c) => formatCsv(history[c][i])).join(","));
  const blob = new Blob([rows.join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `sharks-vs-fish-ultra-seed${state.seed}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function formatCsv(v: number): string {
  return Number.isFinite(v) ? String(+v.toFixed(4)) : "";
}

// ---------- wiring ----------

function init(): void {
  const presetSelect = $<HTMLSelectElement>("#preset");
  for (const [key, p] of Object.entries(ULTRA_PRESETS)) presetSelect.add(new Option(p.label, key));
  const showPreset = () => ($("#preset-desc").textContent = ULTRA_PRESETS[state.preset].description);
  presetSelect.addEventListener("change", () => {
    state.preset = presetSelect.value;
    state.settings = structuredClone(ULTRA_PRESETS[state.preset].settings);
    showPreset();
    renderForm($("#ultra-form"), ULTRA_FIELDS, state.settings as unknown as Record<string, unknown>);
    newPond();
  });
  showPreset();

  const seedInput = $<HTMLInputElement>("#seed");
  seedInput.value = String(state.seed);
  seedInput.addEventListener("change", () => {
    state.seed = Math.abs(Math.floor(+seedInput.value)) || 0;
    seedInput.value = String(state.seed);
    $("#apply-hint").hidden = false;
  });
  $("#new-seed").addEventListener("click", () => {
    state.seed = randomSeed();
    seedInput.value = String(state.seed);
    newPond();
  });

  $("#new").addEventListener("click", newPond);
  $("#run").addEventListener("click", () => setRunning(!state.running));
  $("#step").addEventListener("click", () => {
    setRunning(false);
    stepOnce();
    drawAll();
  });
  $("#csv").addEventListener("click", downloadCsv);

  const target = $<HTMLSelectElement>("#ev-disease-target");
  $("#ev-disease").addEventListener("click", () => {
    sim.trigger("disease", target.value as SpeciesKey);
    drawAll();
  });
  $("#ev-boat").addEventListener("click", () => {
    sim.trigger("boat");
    drawAll();
  });
  $("#ev-heat").addEventListener("click", () => {
    sim.trigger("heatwave");
    drawAll();
  });

  for (const tab of document.querySelectorAll<HTMLButtonElement>("[data-chart]")) {
    tab.addEventListener("click", () => {
      chartTab = tab.dataset.chart as ChartTab;
      for (const t of document.querySelectorAll<HTMLButtonElement>("[data-chart]")) t.setAttribute("aria-selected", String(t === tab));
      drawCharts();
    });
  }
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-trait]")) {
    b.addEventListener("click", () => {
      trait = b.dataset.trait as Trait;
      for (const o of document.querySelectorAll<HTMLButtonElement>("[data-trait]")) o.setAttribute("aria-pressed", String(o === b));
      drawCharts();
    });
  }
  $("#lv-pair").addEventListener("change", drawCharts);
  $<HTMLSelectElement>("#view").addEventListener("change", (e) => {
    view = (e.target as HTMLSelectElement).value as typeof view;
    drawPond();
  });

  const speed = $<HTMLInputElement>("#speed");
  const showSpeed = () => {
    state.speed = +speed.value;
    $("#speed-out").textContent = state.speed >= 61 ? "Max" : `${state.speed}/s`;
  };
  speed.addEventListener("input", showSpeed);
  showSpeed();

  window.addEventListener("resize", () => drawAll());
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => drawAll());

  initBatch(
    () => state.settings,
    (values) => {
      for (const [path, v] of Object.entries(values)) setPath(state.settings as unknown as Record<string, unknown>, path, v);
      renderForm($("#ultra-form"), ULTRA_FIELDS, state.settings as unknown as Record<string, unknown>);
      newPond();
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
  );

  renderForm($("#ultra-form"), ULTRA_FIELDS, state.settings as unknown as Record<string, unknown>);
  newPond();
}

init();
