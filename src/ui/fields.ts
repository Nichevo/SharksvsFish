/**
 * Settings forms are built from these lists, so adding an option to an engine only
 * needs a line here.
 */
export type Field =
  | { kind: "number"; path: string; label: string; min: number; max: number; step?: number; help?: string }
  | { kind: "percent"; path: string; label: string; help?: string }
  | { kind: "bool"; path: string; label: string; help?: string }
  | { kind: "select"; path: string; label: string; options: [string, string][]; help?: string };

export interface FieldGroup {
  title: string;
  fields: Field[];
}

export const CLASSIC_FIELDS: FieldGroup[] = [
  {
    title: "Rules",
    fields: [
      {
        kind: "select",
        path: "rules",
        label: "Rule set",
        options: [
          ["exact", "Classic (exact, as in Excel)"],
          ["intended", "Intended (bugs fixed)"],
        ],
        help: "Exact keeps the original's bugs: fish breed when they meet sharks, sharks breed every time they eat, and moving leaves ghosts behind.",
      },
    ],
  },
  {
    title: "Pond",
    fields: [
      { kind: "number", path: "size", label: "Pond size", min: 5, max: 100, help: "Cells along each side (21 in the original)." },
      { kind: "number", path: "fishStart", label: "Starting fish", min: 0, max: 10000 },
      { kind: "number", path: "sharkStart", label: "Starting sharks", min: 0, max: 10000 },
      { kind: "number", path: "iterationsPerRun", label: "Iterations per run", min: 1, max: 100000, help: "Pauses after this many, like pressing the Excel button once." },
    ],
  },
  {
    title: "Life",
    fields: [
      { kind: "number", path: "fishBreedAge", label: "Fish breeding age", min: 0, max: 1000 },
      { kind: "number", path: "sharkBreedAge", label: "Shark breeding age", min: 0, max: 1000 },
      { kind: "number", path: "fishAgeLimit", label: "Fish age limit", min: 1, max: 10000 },
      { kind: "number", path: "sharkAgeLimit", label: "Shark age limit", min: 1, max: 10000 },
      { kind: "number", path: "starvation", label: "Shark starvation rate", min: 1, max: 1000, help: "Iterations a full shark lasts without eating. Sharks hunt below 60% of this." },
    ],
  },
];

const species = (key: "fish" | "sharks"): Field[] => [
  { kind: "number", path: `${key}.start`, label: "Starting number", min: 0, max: 100000 },
  { kind: "number", path: `${key}.breedAge`, label: "Breeding age", min: 0, max: 10000 },
  { kind: "number", path: `${key}.maxAge`, label: "Age limit", min: 1, max: 100000 },
  { kind: "percent", path: `${key}.breedChance`, label: "Breeding chance" },
  { kind: "number", path: `${key}.litterSize`, label: "Babies per litter", min: 1, max: 8 },
  { kind: "number", path: `${key}.breedCooldown`, label: "Rest between litters", min: 0, max: 1000 },
  { kind: "bool", path: `${key}.needsMate`, label: "Needs a partner to breed", help: "Off: breeds alone once old enough." },
  { kind: "number", path: `${key}.sight`, label: "Sight (cells)", min: 0, max: 20 },
];

export const ENHANCED_FIELDS: FieldGroup[] = [
  {
    title: "Ocean",
    fields: [
      { kind: "number", path: "width", label: "Width", min: 5, max: 400 },
      { kind: "number", path: "height", label: "Height", min: 5, max: 400 },
      { kind: "bool", path: "wrap", label: "Edges wrap round", help: "Off: the edges are walls, as in the original." },
      { kind: "select", path: "neighbourhood", label: "Movement", options: [["moore", "8 directions"], ["vonNeumann", "4 directions"]] },
      { kind: "bool", path: "allowStay", label: "Can stay still" },
      { kind: "select", path: "offspring", label: "Babies are born", options: [["adjacent", "next to the parent"], ["anywhere", "anywhere (original)"]] },
      { kind: "bool", path: "shuffleOrder", label: "Random turn order", help: "Off: oldest creatures always move first." },
      { kind: "number", path: "maxTicks", label: "Stop after (0 = never)", min: 0, max: 1000000 },
    ],
  },
  {
    title: "Fish",
    fields: [...species("fish"), { kind: "percent", path: "fish.fleeChance", label: "Chance to flee sharks" }],
  },
  {
    title: "Sharks",
    fields: [
      ...species("sharks"),
      { kind: "number", path: "sharks.startEnergy", label: "Starting energy", min: 1, max: 1000 },
      { kind: "number", path: "sharks.maxEnergy", label: "Max energy", min: 1, max: 1000, help: "Sharks use 1 energy per iteration and die at 0." },
      { kind: "number", path: "sharks.energyPerMeal", label: "Energy per fish", min: 0, max: 1000 },
      { kind: "percent", path: "sharks.hungerThreshold", label: "Hunts below (of max energy)" },
      { kind: "percent", path: "sharks.breedEnergy", label: "Needs energy to breed" },
      { kind: "bool", path: "sharks.moveOnEat", label: "Moves into the fish's cell" },
    ],
  },
  {
    title: "Algae",
    fields: [
      { kind: "bool", path: "algae.enabled", label: "Fish must eat algae", help: "Adds a food chain: algae feeds fish, fish feed sharks." },
      { kind: "percent", path: "algae.startCover", label: "Starting algae cover" },
      { kind: "number", path: "algae.regrowTime", label: "Regrow time", min: 1, max: 1000 },
      { kind: "number", path: "algae.fishStartEnergy", label: "Fish starting energy", min: 1, max: 1000 },
      { kind: "number", path: "algae.fishMaxEnergy", label: "Fish max energy", min: 1, max: 1000 },
      { kind: "number", path: "algae.energyPerAlgae", label: "Energy per algae", min: 0, max: 1000 },
    ],
  },
];

export function getPath(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], obj);
}

export function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split(".");
  const last = keys.pop()!;
  const target = keys.reduce<Record<string, unknown>>((o, k) => o[k] as Record<string, unknown>, obj);
  target[last] = value;
}
