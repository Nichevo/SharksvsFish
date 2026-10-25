/** Settings form and presets for Ultra Enhanced mode. */
import { ULTRA_DEFAULTS, type SpeciesKey, type UltraSettings } from "../engine/ultra";
import type { Field, FieldGroup } from "../ui/fields";

export type UltraPreset = Omit<UltraSettings, "seed">;

function preset(changes: (p: UltraPreset) => void): UltraPreset {
  const p = structuredClone(ULTRA_DEFAULTS);
  changes(p);
  return p;
}

export const ULTRA_PRESETS: Record<string, { label: string; description: string; settings: UltraPreset }> = {
  evolving: {
    label: "Evolving ocean",
    description: "Babies inherit their parent's speed, sight and lifespan with small mutations, and algae rises and falls through the year.",
    settings: preset(() => {}),
  },
  arms: {
    label: "Arms race",
    description: "Cheap traits and bigger mutations: watch sharks and fish race each other to get faster.",
    settings: preset((p) => {
      p.evolution.mutation = 0.15;
      p.evolution.tradeOff = 0.2;
      p.species.fish.fleeChance = 0.9;
    }),
  },
  winters: {
    label: "Hard winters",
    description: "Algae almost stops growing in winter, so the fish crash every year and the sharks follow.",
    settings: preset((p) => {
      p.seasons.strength = 1;
      p.seasons.yearLength = 160;
    }),
  },
  eventful: {
    label: "Eventful ocean",
    description: "Disease, fishing boats and heatwaves arrive at random, about once every 150 iterations.",
    settings: preset((p) => {
      p.events.randomEvery = 150;
    }),
  },
  foodweb: {
    label: "Food web",
    description: "Adds barracuda in the middle (they eat fish, sharks eat them) and orcas at the top, hunting sharks.",
    settings: preset((p) => {
      p.species.barracuda.enabled = true;
      p.species.orcas.enabled = true;
    }),
  },
  orcas: {
    label: "Orcas",
    description: "Fish, sharks and a few orcas that hunt the sharks. Watch whether the sharks get faster to escape.",
    settings: preset((p) => {
      p.species.orcas.enabled = true;
    }),
  },
  fixed: {
    label: "No evolution",
    description: "The same ocean with traits fixed, to compare against the evolving runs.",
    settings: preset((p) => {
      p.evolution.enabled = false;
    }),
  },
};

const species = (key: SpeciesKey): Field[] => {
  const p = `species.${key}`;
  return [
    { kind: "number", path: `${p}.start`, label: "Starting number", min: 0, max: 100000 },
    { kind: "number", path: `${p}.breedAge`, label: "Breeding age", min: 0, max: 10000 },
    { kind: "number", path: `${p}.maxAge`, label: "Starting lifespan", min: 3, max: 5000, help: "Evolves when evolution is on." },
    { kind: "number", path: `${p}.speed`, label: "Starting speed", min: 0.2, max: 4, step: 0.1, help: "Moves per iteration. 1.5 means one move, plus a second half the time." },
    { kind: "number", path: `${p}.sight`, label: "Starting sight (cells)", min: 0, max: 8, step: 0.1 },
    { kind: "percent", path: `${p}.breedChance`, label: "Breeding chance" },
    { kind: "number", path: `${p}.litterSize`, label: "Babies per litter", min: 1, max: 8 },
    { kind: "number", path: `${p}.breedCooldown`, label: "Rest between litters", min: 0, max: 1000 },
    { kind: "number", path: `${p}.startEnergy`, label: "Starting energy", min: 1, max: 1000 },
    { kind: "number", path: `${p}.maxEnergy`, label: "Max energy", min: 1, max: 1000 },
    { kind: "number", path: `${p}.energyPerMeal`, label: key === "fish" ? "Energy per algae" : "Energy per meal", min: 0, max: 1000 },
    { kind: "percent", path: `${p}.breedEnergy`, label: "Needs energy to breed" },
  ];
};

const predator = (key: SpeciesKey): Field[] => [
  ...species(key),
  { kind: "percent", path: `species.${key}.hungerThreshold`, label: "Hunts below (of max energy)" },
];

export const ULTRA_FIELDS: FieldGroup[] = [
  {
    title: "Ocean",
    fields: [
      { kind: "number", path: "width", label: "Width", min: 5, max: 400 },
      { kind: "number", path: "height", label: "Height", min: 5, max: 400 },
      { kind: "bool", path: "wrap", label: "Edges wrap round" },
      { kind: "number", path: "maxTicks", label: "Stop after (0 = never)", min: 0, max: 1000000 },
    ],
  },
  {
    title: "Evolution",
    fields: [
      { kind: "bool", path: "evolution.enabled", label: "Traits are inherited and mutate", help: "Each baby gets its parent's speed, sight and lifespan, nudged up or down a little." },
      { kind: "percent", path: "evolution.mutation", label: "Mutation size", help: "How big a typical nudge is, as a share of the parent's value." },
      { kind: "percent", path: "evolution.tradeOff", label: "Cost of good traits", help: "Speed and sight burn extra energy, and a longer life means fewer babies. At 0 every trait is free." },
    ],
  },
  {
    title: "Algae and seasons",
    fields: [
      { kind: "bool", path: "algae.enabled", label: "Fish must eat algae" },
      { kind: "percent", path: "algae.startCover", label: "Starting algae cover" },
      { kind: "number", path: "algae.regrowTime", label: "Regrow time", min: 1, max: 1000, help: "Average iterations for grazed algae to grow back in a normal season." },
      { kind: "bool", path: "seasons.enabled", label: "Seasons", help: "Algae grows fastest in summer and slowest in winter." },
      { kind: "number", path: "seasons.yearLength", label: "Iterations per year", min: 8, max: 10000 },
      { kind: "percent", path: "seasons.strength", label: "Seasonal swing", help: "100% stops algae growing in midwinter and doubles it in midsummer." },
    ],
  },
  {
    title: "Events",
    fields: [
      { kind: "number", path: "events.randomEvery", label: "Random event every (0 = off)", min: 0, max: 100000, help: "Average iterations between surprise events. The buttons above the ocean always work." },
      { kind: "percent", path: "events.disease.spread", label: "Disease: chance to infect a neighbour" },
      { kind: "percent", path: "events.disease.lethality", label: "Disease: chance of dying each iteration" },
      { kind: "number", path: "events.disease.duration", label: "Disease: iterations until recovered", min: 1, max: 1000 },
      { kind: "number", path: "events.boats.width", label: "Fishing net width (cells)", min: 1, max: 50 },
      { kind: "percent", path: "events.boats.catchChance", label: "Chance a fish in the net is caught", help: "Barracuda count as fish here." },
      { kind: "percent", path: "events.boats.bycatch", label: "Chance a shark or orca is caught too" },
      { kind: "number", path: "events.heatwave.length", label: "Heatwave length", min: 1, max: 1000 },
    ],
  },
  {
    title: "Fish",
    fields: [...species("fish"), { kind: "percent", path: "species.fish.fleeChance", label: "Chance to flee predators" }],
  },
  {
    title: "Barracuda",
    fields: [
      { kind: "bool", path: "species.barracuda.enabled", label: "Include barracuda", help: "A mid-level predator: eats fish, and sharks and orcas eat it." },
      ...predator("barracuda"),
      { kind: "percent", path: "species.barracuda.fleeChance", label: "Chance to flee predators" },
      { kind: "percent", path: "species.barracuda.dodgeChance", label: "Chance to dodge an attack" },
    ],
  },
  {
    title: "Sharks",
    fields: [
      ...predator("sharks"),
      { kind: "percent", path: "species.sharks.fleeChance", label: "Chance to flee orcas" },
      { kind: "percent", path: "species.sharks.dodgeChance", label: "Chance to dodge an orca" },
    ],
  },
  {
    title: "Orcas",
    fields: [{ kind: "bool", path: "species.orcas.enabled", label: "Include orcas", help: "The apex predator: hunts sharks first, and barracuda." }, ...predator("orcas")],
  },
];
