import "./style.css";
import { CLASSIC_DEFAULTS, ClassicSimulation, type ClassicSettings } from "./engine/classic";
import { EnhancedSimulation, type EnhancedSettings } from "./engine/enhanced";
import { ENHANCED_PRESETS } from "./engine/presets";
import { randomSeed } from "./engine/rng";
import { ALGAE, FISH, SHARK, type Simulation } from "./engine/types";
import { PopulationChart, type History } from "./ui/chart";
import { CLASSIC_FIELDS, ENHANCED_FIELDS, getPath, setPath, type Field, type FieldGroup } from "./ui/fields";

type Mode = "classic" | "enhanced";

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

const state = {
  mode: "classic" as Mode,
  classic: { ...CLASSIC_DEFAULTS } as Omit<ClassicSettings, "seed">,
  enhanced: structuredClone(ENHANCED_PRESETS.balanced.settings) as Omit<EnhancedSettings, "seed">,
  preset: "balanced",
  seed: randomSeed(),
  running: false,
  speed: 10,
};

let sim: Simulation;
let cells: Uint8Array;
let history: History;
const chart = new PopulationChart($("#chart"), $("#tooltip"));
const pond = $<HTMLCanvasElement>("#pond");
const pondCtx = pond.getContext("2d")!;

// ---------- settings forms ----------

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
  const id = `f-${field.path.replace(/\./g, "-")}`;
  let input: HTMLInputElement | HTMLSelectElement;

  if (field.kind === "select") {
    input = document.createElement("select");
    for (const [v, text] of field.options) input.add(new Option(text, v, false, v === value));
    input.addEventListener("change", () => setPath(target, field.path, input.value));
  } else {
    input = document.createElement("input");
    if (field.kind === "bool") {
      input.type = "checkbox";
      input.checked = Boolean(value);
      input.addEventListener("change", () => setPath(target, field.path, (input as HTMLInputElement).checked));
    } else if (field.kind === "percent") {
      input.type = "number";
      input.min = "0";
      input.max = "100";
      input.step = "1";
      input.value = String(Math.round((value as number) * 100));
      input.addEventListener("change", () => setPath(target, field.path, clamp(+input.value, 0, 100) / 100));
    } else {
      input.type = "number";
      input.min = String(field.min);
      input.max = String(field.max);
      input.step = String(field.step ?? 1);
      input.value = String(value);
      input.addEventListener("change", () => {
        const v = clamp(Math.round(+input.value), field.min, field.max);
        input.value = String(v);
        setPath(target, field.path, v);
      });
    }
  }
  input.id = id;
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
  // Settings apply when a new pond is made.
  input.addEventListener("change", () => markDirty());
  return wrap;
}

function clamp(v: number, lo: number, hi: number): number {
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo;
}

function markDirty(): void {
  $("#apply-hint").hidden = false;
}

function renderForms(): void {
  renderForm($("#classic-form"), CLASSIC_FIELDS, state.classic as unknown as Record<string, unknown>);
  renderForm($("#enhanced-form"), ENHANCED_FIELDS, state.enhanced as unknown as Record<string, unknown>);
}

// ---------- simulation lifecycle ----------

function newPond(): void {
  sim =
    state.mode === "classic"
      ? new ClassicSimulation({ ...state.classic, seed: state.seed })
      : new EnhancedSimulation({ ...structuredClone(state.enhanced), seed: state.seed });
  cells = new Uint8Array(sim.width * sim.height);
  history = { ticks: [], fish: [], sharks: [] };
  record();
  $("#apply-hint").hidden = true;
  setRunning(false);
  drawAll();
}

function record(): void {
  const { fish, sharks } = sim.counts();
  history.ticks.push(sim.tick);
  history.fish.push(fish);
  history.sharks.push(sharks);
}

function stepOnce(): boolean {
  if (sim.finished()) return false;
  sim.step();
  record();
  return !sim.finished() && !sim.atPausePoint();
}

function setRunning(on: boolean): void {
  state.running = on && !sim.finished();
  const btn = $<HTMLButtonElement>("#run");
  btn.textContent = state.running ? "Pause" : sim.tick > 0 && !sim.finished() ? "Continue" : "Run";
  btn.setAttribute("aria-pressed", String(state.running));
  if (state.running) {
    lastFrame = performance.now();
    owed = 0;
    requestAnimationFrame(loop);
  }
}

let lastFrame = 0;
let owed = 0;
function loop(now: number): void {
  if (!state.running) return;
  const max = state.speed >= 61;
  owed += max ? 50 : ((now - lastFrame) / 1000) * state.speed;
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
  const colors: Record<number, string> = {
    [FISH]: css.getPropertyValue("--fish"),
    [SHARK]: css.getPropertyValue("--shark"),
    [ALGAE]: css.getPropertyValue("--algae"),
  };
  pondCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  pondCtx.fillStyle = css.getPropertyValue("--water");
  pondCtx.fillRect(0, 0, w, h);
  sim.paint(cells);
  const gap = cell >= 6 ? 1 : 0;
  for (let i = 0; i < cells.length; i++) {
    const v = cells[i];
    if (!v) continue;
    pondCtx.fillStyle = colors[v];
    const x = (i % sim.width) * cell;
    const y = Math.floor(i / sim.width) * cell;
    if (v === SHARK && cell >= 8) {
      // Sharks get a diamond so they don't rely on colour alone.
      pondCtx.beginPath();
      pondCtx.moveTo(x + cell / 2, y + gap);
      pondCtx.lineTo(x + cell - gap, y + cell / 2);
      pondCtx.lineTo(x + cell / 2, y + cell - gap);
      pondCtx.lineTo(x + gap, y + cell / 2);
      pondCtx.fill();
    } else {
      pondCtx.fillRect(x + gap, y + gap, cell - gap * 2, cell - gap * 2);
    }
  }
}

function drawStats(): void {
  const { fish, sharks } = sim.counts();
  $("#stat-tick").textContent = String(sim.tick);
  $("#stat-fish").textContent = String(fish);
  $("#stat-sharks").textContent = String(sharks);
  let status = "";
  if (sim.finished()) {
    status =
      fish === 0 && sharks === 0
        ? "Everything died out."
        : fish === 0
          ? "The fish died out."
          : sharks === 0
            ? "The sharks died out."
            : "Reached the iteration limit.";
  } else if (sim.atPausePoint() && !state.running) {
    status = "End of a run. Press Continue for the next one.";
  }
  $("#status").textContent = status;
}

function drawAll(): void {
  drawPond();
  drawStats();
  chart.draw(history);
  if (!state.running) setRunButtonLabel();
}

function setRunButtonLabel(): void {
  const btn = $<HTMLButtonElement>("#run");
  btn.textContent = sim.finished() ? "Run" : sim.tick > 0 ? "Continue" : "Run";
  btn.disabled = sim.finished();
}

function downloadCsv(): void {
  const rows = ["iteration,fish,sharks"];
  for (let i = 0; i < history.ticks.length; i++) rows.push(`${history.ticks[i]},${history.fish[i]},${history.sharks[i]}`);
  const blob = new Blob([rows.join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `sharks-vs-fish-${state.mode}-seed${state.seed}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------- wiring ----------

function setMode(mode: Mode): void {
  state.mode = mode;
  for (const tab of document.querySelectorAll<HTMLButtonElement>("[data-mode]")) {
    tab.setAttribute("aria-selected", String(tab.dataset.mode === mode));
  }
  $("#classic-panel").hidden = mode !== "classic";
  $("#enhanced-panel").hidden = mode !== "enhanced";
  newPond();
}

function init(): void {
  const presetSelect = $<HTMLSelectElement>("#preset");
  for (const [key, p] of Object.entries(ENHANCED_PRESETS)) presetSelect.add(new Option(p.label, key));
  presetSelect.addEventListener("change", () => {
    state.preset = presetSelect.value;
    state.enhanced = structuredClone(ENHANCED_PRESETS[state.preset].settings);
    $("#preset-desc").textContent = ENHANCED_PRESETS[state.preset].description;
    renderForms();
    newPond();
  });
  $("#preset-desc").textContent = ENHANCED_PRESETS[state.preset].description;

  $("#classic-reset").addEventListener("click", () => {
    state.classic = { ...CLASSIC_DEFAULTS };
    renderForms();
    newPond();
  });

  for (const tab of document.querySelectorAll<HTMLButtonElement>("[data-mode]")) {
    tab.addEventListener("click", () => setMode(tab.dataset.mode as Mode));
  }

  const seedInput = $<HTMLInputElement>("#seed");
  seedInput.value = String(state.seed);
  seedInput.addEventListener("change", () => {
    state.seed = Math.abs(Math.floor(+seedInput.value)) || 0;
    seedInput.value = String(state.seed);
    markDirty();
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

  const speed = $<HTMLInputElement>("#speed");
  const speedOut = $("#speed-out");
  const showSpeed = () => {
    state.speed = +speed.value;
    speedOut.textContent = state.speed >= 61 ? "Max" : `${state.speed}/s`;
  };
  speed.addEventListener("input", showSpeed);
  showSpeed();

  window.addEventListener("resize", () => drawAll());
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => drawAll());

  renderForms();
  setMode("classic");
}

init();
