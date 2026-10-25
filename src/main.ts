import "./style.css";
import { CLASSIC_DEFAULTS, ClassicSimulation, type ClassicSettings } from "./engine/classic";
import { EnhancedSimulation, type EnhancedSettings } from "./engine/enhanced";
import { ENHANCED_PRESETS } from "./engine/presets";
import { randomSeed } from "./engine/rng";
import { ALGAE, FISH, FISH_FEMALE, SHARK, SHARK_FEMALE, type Simulation } from "./engine/types";
import { LineChart, drawPhase, drawPyramid, emptyHistory, type History, type SeriesDef } from "./ui/chart";
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
const chart = new LineChart($("#chart"), $("#tooltip"));

type ChartTab = "population" | "births" | "eaten" | "deaths" | "ages" | "cycle" | "algae";
let chartTab: ChartTab = "population";

const FISH_LINE = { color: "--fish" };
const SHARK_LINE = { color: "--shark" };
const ALGAE_LINE = { color: "--algae-line" };
const LINE_CHARTS: Partial<Record<ChartTab, { title: string; note: string; series: SeriesDef[]; smoothable: boolean }>> = {
  population: {
    title: "Population over time",
    note: "",
    series: [
      { key: "fish", label: "Fish", ...FISH_LINE },
      { key: "sharks", label: "Sharks", ...SHARK_LINE },
    ],
    smoothable: false,
  },
  births: {
    title: "Births per iteration",
    note: "",
    series: [
      { key: "fishBorn", label: "Fish born", ...FISH_LINE },
      { key: "sharksBorn", label: "Sharks born", ...SHARK_LINE },
    ],
    smoothable: true,
  },
  eaten: {
    title: "Fish eaten per iteration",
    note: "How many fish the sharks ate in each iteration.",
    series: [{ key: "fishEaten", label: "Fish eaten", ...SHARK_LINE }],
    smoothable: true,
  },
  deaths: {
    title: "Deaths per iteration",
    note: "All causes: eaten, old age and starvation. The totals table below splits them by cause.",
    series: [
      { key: "fishDied", label: "Fish died", ...FISH_LINE },
      { key: "sharksDied", label: "Sharks died", ...SHARK_LINE },
    ],
    smoothable: true,
  },
  algae: {
    title: "Algae and fish",
    note: "Patches of algae (cells with food on them) against the fish grazing them. Fish that can't find algae starve.",
    series: [
      { key: "algae", label: "Algae patches", ...ALGAE_LINE },
      { key: "fish", label: "Fish", ...FISH_LINE },
    ],
    smoothable: false,
  },
};

/** The Eaten chart also shows algae grazed when the food chain is on. */
const EATEN_WITH_ALGAE = {
  title: "Eaten per iteration",
  note: "Fish eaten by sharks, and algae patches grazed by fish, in each iteration.",
  series: [
    { key: "fishEaten", label: "Fish eaten", ...SHARK_LINE },
    { key: "algaeEaten", label: "Algae grazed", ...ALGAE_LINE },
  ] as SeriesDef[],
  smoothable: true,
};

const totals = {
  fishBorn: 0,
  sharksBorn: 0,
  fishEaten: 0,
  fishOldAge: 0,
  fishStarved: 0,
  sharksOldAge: 0,
  sharksStarved: 0,
  fishPeak: 0,
  sharksPeak: 0,
  algaeEaten: 0,
  algaePeak: 0,
};
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
  history = emptyHistory();
  for (const k of Object.keys(totals) as (keyof typeof totals)[]) totals[k] = 0;
  record();
  $("#apply-hint").hidden = true;
  setRunning(false);
  drawAll();
}

function record(): void {
  const { fish, sharks } = sim.counts();
  const e = sim.tick === 0 ? null : sim.lastEvents();
  history.ticks.push(sim.tick);
  history.fish.push(fish);
  history.sharks.push(sharks);
  history.fishBorn.push(e?.fishBorn ?? 0);
  history.sharksBorn.push(e?.sharksBorn ?? 0);
  history.fishEaten.push(e?.fishEaten ?? 0);
  history.fishOldAge.push(e?.fishOldAge ?? 0);
  history.fishStarved.push(e?.fishStarved ?? 0);
  history.sharksOldAge.push(e?.sharksOldAge ?? 0);
  history.sharksStarved.push(e?.sharksStarved ?? 0);
  history.fishDied.push(e ? e.fishEaten + e.fishOldAge + e.fishStarved : 0);
  history.sharksDied.push(e ? e.sharksOldAge + e.sharksStarved : 0);
  const algae = sim.algaeCells() ?? 0;
  history.algae.push(algae);
  history.algaeEaten.push(e?.algaeEaten ?? 0);
  totals.algaePeak = Math.max(totals.algaePeak, algae);
  if (e) {
    totals.fishBorn += e.fishBorn;
    totals.sharksBorn += e.sharksBorn;
    totals.fishEaten += e.fishEaten;
    totals.fishOldAge += e.fishOldAge;
    totals.fishStarved += e.fishStarved;
    totals.sharksOldAge += e.sharksOldAge;
    totals.sharksStarved += e.sharksStarved;
    totals.algaeEaten += e.algaeEaten;
  }
  totals.fishPeak = Math.max(totals.fishPeak, fish);
  totals.sharksPeak = Math.max(totals.sharksPeak, sharks);
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
  // With sexes on, males are the darker shade and females the lighter one.
  const sexes = sim.hasSexes();
  const colors: Record<number, string> = {
    [FISH]: css.getPropertyValue(sexes ? "--fish-male" : "--fish"),
    [SHARK]: css.getPropertyValue(sexes ? "--shark-male" : "--shark"),
    [FISH_FEMALE]: css.getPropertyValue("--fish-female"),
    [SHARK_FEMALE]: css.getPropertyValue("--shark-female"),
    [ALGAE]: css.getPropertyValue("--algae"),
  };
  $("#sex-key").hidden = !sexes;
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
    if ((v === SHARK || v === SHARK_FEMALE) && cell >= 8) {
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
  drawCharts();
  drawTotals();
  if (!state.running) setRunButtonLabel();
}

function drawCharts(): void {
  const hasAlgae = sim.algaeCells() !== null;
  const algaeTab = document.querySelector<HTMLButtonElement>('[data-chart="algae"]')!;
  algaeTab.hidden = !hasAlgae;
  if (!hasAlgae && chartTab === "algae") selectChart("population");
  const line = chartTab === "eaten" && hasAlgae ? EATEN_WITH_ALGAE : LINE_CHARTS[chartTab];
  $("#line-box").hidden = !line;
  $("#ages-box").hidden = chartTab !== "ages";
  $("#cycle-box").hidden = chartTab !== "cycle";
  $("#smooth-wrap").hidden = !line?.smoothable;
  let title = line?.title ?? "";
  let note = line?.note ?? "";
  let legend: SeriesDef[] = line?.series ?? [];
  if (line) {
    const window = line.smoothable && $<HTMLInputElement>("#smooth").checked ? 10 : 1;
    chart.draw(history, line.series, window);
  } else if (chartTab === "ages") {
    const sexes = sim.hasSexes();
    title = sexes ? "Age and sex right now" : "Ages right now";
    note = sexes
      ? "Each bar is an age band: males on the left, females on the right."
      : sim instanceof ClassicSimulation
        ? "The original model has no males and females, so this shows ages only."
        : "Switch on \u201cSeparate males and females\u201d (Ocean settings) to split by sex.";
    const individuals = sim.individuals();
    const limits = sim.ageLimits();
    drawPyramid($("#pyramid-fish"), individuals, FISH, limits.fish, sexes);
    drawPyramid($("#pyramid-sharks"), individuals, SHARK, limits.sharks, sexes);
    legend = [];
  } else {
    title = "Fish against sharks";
    note = "Each point is one iteration. A loop means the two populations cycle; a line running into an axis means one died out. Older parts fade.";
    drawPhase($("#phase"), history);
    legend = [];
  }
  $("#chart-title").textContent = title;
  $("#chart-note").textContent = note;
  $("#legend-items").innerHTML = legend
    .map((s) => `<span><i class="key ${s.color === "--shark" ? "key-shark" : ""}" style="background:var(${s.color})"></i>${s.label}</span>`)
    .join("");
}

function selectChart(tab: ChartTab): void {
  chartTab = tab;
  for (const t of document.querySelectorAll<HTMLButtonElement>("[data-chart]")) {
    t.setAttribute("aria-selected", String(t.dataset.chart === tab));
  }
}

function drawTotals(): void {
  const { fish, sharks } = sim.counts();
  const set = (id: string, v: number) => ($(`#t-${id}`).textContent = v.toLocaleString());
  set("fish-born", totals.fishBorn);
  set("fish-eaten", totals.fishEaten);
  set("fish-old", totals.fishOldAge);
  set("fish-starved", totals.fishStarved);
  set("fish-alive", fish);
  set("fish-peak", totals.fishPeak);
  set("sharks-born", totals.sharksBorn);
  set("sharks-old", totals.sharksOldAge);
  set("sharks-starved", totals.sharksStarved);
  set("sharks-alive", sharks);
  set("sharks-peak", totals.sharksPeak);
  const algae = sim.algaeCells();
  $("#t-algae-row").hidden = algae === null;
  if (algae !== null) {
    set("algae-eaten", totals.algaeEaten);
    set("algae-alive", algae);
    set("algae-peak", totals.algaePeak);
  }
}

function setRunButtonLabel(): void {
  const btn = $<HTMLButtonElement>("#run");
  btn.textContent = sim.finished() ? "Run" : sim.tick > 0 ? "Continue" : "Run";
  btn.disabled = sim.finished();
}

function downloadCsv(): void {
  const cols = Object.keys(history) as (keyof History)[];
  const rows = [cols.join(",")];
  for (let i = 0; i < history.ticks.length; i++) rows.push(cols.map((c) => history[c][i]).join(","));
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
  for (const tab of document.querySelectorAll<HTMLButtonElement>("[data-chart]")) {
    tab.addEventListener("click", () => {
      selectChart(tab.dataset.chart as ChartTab);
      drawCharts();
    });
  }
  $("#smooth").addEventListener("change", drawCharts);

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
